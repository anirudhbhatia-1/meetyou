output "bucket_name" {
  description = "The name of the Google Cloud Storage bucket for audio/video chunks."
  value       = google_storage_bucket.audio_chunks.name
}

output "bucket_url" {
  description = "The gs:// URI of the storage bucket."
  value       = google_storage_bucket.audio_chunks.url
}

