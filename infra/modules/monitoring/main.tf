# Observability (S2-11, ARCHITECTURE §20): log-based metrics on the content-free JSON logs
# (`@meetyou/log`: `message` is the event name, fields are IDs/counts/codes), alert policies and a
# dashboard. Matching on `jsonPayload.message` keeps this independent of any logging SDK.

locals {
  prefix  = "meetyou-${var.environment}"
  gateway = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.prefix}-gateway\""
  worker  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.prefix}-worker\""
  ours    = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=~\"^${local.prefix}-\""

  counters = {
    # Frames that could not be stored durably: audio loss (should always be 0).
    audio_loss = {
      description = "Gateway audio chunk writes that failed (audio-loss events)."
      filter      = "${local.gateway} AND jsonPayload.message=\"chunk.write_failed\""
    }
    stt_errors = {
      description = "STT connections that failed to open or reported degraded/down health."
      filter      = "${local.gateway} AND (jsonPayload.message=\"stt.open_failed\" OR (jsonPayload.message=\"stt.health\" AND jsonPayload.health!=\"ok\"))"
    }
    stream_reconnects = {
      description = "Extension WebSocket disconnects (each is followed by a resume)."
      filter      = "${local.gateway} AND jsonPayload.message=\"stream.disconnected\""
    }
    sessions_started = {
      description = "Recording sessions created on the gateway."
      filter      = "${local.gateway} AND jsonPayload.message=\"session.created\""
    }
  }
}

resource "google_logging_metric" "counter" {
  for_each    = local.counters
  project     = var.project_id
  name        = "${local.prefix}/${each.key}"
  description = each.value.description
  filter      = each.value.filter
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# Jobs that used all their attempts, by task: covers video.finalize, meeting/account deletion and
# the retention sweep (alert "retention job failures").
resource "google_logging_metric" "jobs_dead_lettered" {
  project     = var.project_id
  name        = "${local.prefix}/jobs_dead_lettered"
  description = "Background jobs moved to failed_jobs after their last attempt."
  filter      = "${local.worker} AND jsonPayload.message=\"job.dead_lettered\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "task"
      value_type = "STRING"
    }
  }
  label_extractors = {
    task = "EXTRACT(jsonPayload.task)"
  }
}

resource "google_logging_metric" "service_errors" {
  project     = var.project_id
  name        = "${local.prefix}/service_errors"
  description = "ERROR-or-worse log lines per service."
  filter      = "${local.ours} AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "service"
      value_type = "STRING"
    }
  }
  label_extractors = {
    service = "EXTRACT(resource.labels.service_name)"
  }
}

# The worker logs `queue.depth` every minute: due jobs waiting for a worker.
resource "google_logging_metric" "queue_depth" {
  project         = var.project_id
  name            = "${local.prefix}/queue_depth"
  description     = "Due background jobs not yet picked up (sampled every minute)."
  filter          = "${local.worker} AND jsonPayload.message=\"queue.depth\""
  value_extractor = "EXTRACT(jsonPayload.count)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "1"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 16
      growth_factor      = 2
      scale              = 1
    }
  }
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "Minutes ${var.environment} alerts (${each.value})"
  type         = "email"
  labels = {
    email_address = each.value
  }
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.id]
  metric   = "metric.type=\"logging.googleapis.com/user/${local.prefix}"
  alerts = {
    audio_loss = {
      name      = "Audio loss (${var.environment})"
      filter    = "${local.metric}/audio_loss\" AND resource.type=\"cloud_run_revision\""
      threshold = 0
      window    = "300s"
      doc       = "The gateway failed to store audio chunks. Check gateway logs for chunk.write_failed and the bucket's health."
    }
    stt_errors = {
      name      = "STT errors (${var.environment})"
      filter    = "${local.metric}/stt_errors\" AND resource.type=\"cloud_run_revision\""
      threshold = 5
      window    = "600s"
      doc       = "Deepgram connections are failing or degraded; live transcripts are delayed (sessions are marked for batch)."
    }
    jobs_dead_lettered = {
      name      = "Background job failed for good (${var.environment})"
      filter    = "${local.metric}/jobs_dead_lettered\" AND resource.type=\"cloud_run_revision\""
      threshold = 0
      window    = "300s"
      doc       = "A job used all its attempts (label `task`: video.finalize, meeting.delete, account.delete, retention.sweep). See failed_jobs."
    }
    service_errors = {
      name      = "Error log spike (${var.environment})"
      filter    = "${local.metric}/service_errors\" AND resource.type=\"cloud_run_revision\""
      threshold = 20
      window    = "600s"
      doc       = "More than 20 ERROR lines in 10 minutes from one Minutes service."
    }
  }
}

resource "google_monitoring_alert_policy" "log_metric" {
  for_each              = local.alerts
  project               = var.project_id
  display_name          = each.value.name
  combiner              = "OR"
  notification_channels = local.channels
  documentation {
    content   = each.value.doc
    mime_type = "text/markdown"
  }
  conditions {
    display_name = each.value.name
    condition_threshold {
      filter          = each.value.filter
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "0s"
      aggregations {
        alignment_period     = each.value.window
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }
  depends_on = [google_logging_metric.counter, google_logging_metric.jobs_dead_lettered, google_logging_metric.service_errors]
}

resource "google_monitoring_alert_policy" "queue_backlog" {
  project               = var.project_id
  display_name          = "Job queue backlog (${var.environment})"
  combiner              = "OR"
  notification_channels = local.channels
  documentation {
    content   = "More than 50 due jobs have waited for 15 minutes: the worker is down or too slow."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "Queue depth p99 > 50"
    condition_threshold {
      filter          = "${local.metric}/queue_depth\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 50
      duration        = "900s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
      }
      trigger {
        count = 1
      }
    }
  }
  depends_on = [google_logging_metric.queue_depth]
}

resource "google_monitoring_alert_policy" "api_5xx" {
  project               = var.project_id
  display_name          = "API 5xx (${var.environment})"
  combiner              = "OR"
  notification_channels = local.channels
  documentation {
    content   = "The REST API answered more than 5 server errors in 5 minutes."
    mime_type = "text/markdown"
  }
  conditions {
    display_name = "API 5xx > 5 in 5 min"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.prefix}-api\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger {
        count = 1
      }
    }
  }
}

locals {
  tile = {
    sessions = { title = "Sessions started", filter = "${local.metric}/sessions_started\"", aligner = "ALIGN_SUM" }
    reconnects = { title = "Stream reconnects", filter = "${local.metric}/stream_reconnects\"", aligner = "ALIGN_SUM" }
    audio_loss = { title = "Audio loss events (should be 0)", filter = "${local.metric}/audio_loss\"", aligner = "ALIGN_SUM" }
    stt_errors = { title = "STT errors", filter = "${local.metric}/stt_errors\"", aligner = "ALIGN_SUM" }
    dead_letters = { title = "Jobs failed for good (by task)", filter = "${local.metric}/jobs_dead_lettered\"", aligner = "ALIGN_SUM" }
    queue = { title = "Queue depth (p99)", filter = "${local.metric}/queue_depth\"", aligner = "ALIGN_PERCENTILE_99" }
    errors = { title = "ERROR lines by service", filter = "${local.metric}/service_errors\"", aligner = "ALIGN_SUM" }
    api_latency = { title = "API latency p95", filter = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.labels.service_name=\"${local.prefix}-api\"", aligner = "ALIGN_PERCENTILE_95" }
  }
}

resource "google_monitoring_dashboard" "overview" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "Minutes ${var.environment}"
    mosaicLayout = {
      columns = 12
      tiles = [for i, k in sort(keys(local.tile)) : {
        xPos   = (i % 2) * 6
        yPos   = floor(i / 2) * 4
        width  = 6
        height = 4
        widget = {
          title = local.tile[k].title
          xyChart = {
            dataSets = [{
              plotType = "LINE"
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "${local.tile[k].filter} AND resource.type=\"cloud_run_revision\""
                  aggregation = {
                    alignmentPeriod  = "300s"
                    perSeriesAligner = local.tile[k].aligner
                  }
                }
              }
            }]
          }
        }
      }]
    }
  })
  depends_on = [
    google_logging_metric.counter,
    google_logging_metric.jobs_dead_lettered,
    google_logging_metric.service_errors,
    google_logging_metric.queue_depth,
  ]
}
