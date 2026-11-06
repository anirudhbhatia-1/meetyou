variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "environment" {
  description = "Environment name; services are named meetyou-<environment>-<service>."
  type        = string
}

variable "alert_emails" {
  description = "Addresses that receive alert notifications. Empty: alerts are created without channels (visible in the console only)."
  type        = list(string)
  default     = []
}

variable "stt_session_cost_alert_usd" {
  description = "Alert when one session's estimated STT cost exceeds this (a runaway or stuck stream). At the gateway's rate (0.0092 USD/min) a 60-minute meeting with both lanes is about 1.1 USD."
  type        = number
  default     = 1.5
}

variable "billing_account_id" {
  description = "Billing account for the monthly budget alert (e.g. 012345-6789AB-CDEF01). Empty: no budget is created. Applying it needs Billing Account Administrator or Costs Manager."
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "Monthly Google Cloud budget for this project, in the billing account's currency."
  type        = number
  default     = 5000
}

variable "budget_currency" {
  description = "Currency of the billing account (the budget must use the same one)."
  type        = string
  default     = "INR"
}
