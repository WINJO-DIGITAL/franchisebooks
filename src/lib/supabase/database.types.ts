
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "accounts": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"anomalies": {
                  Row: {
                    "account_id": string,"actual_value": string | null,"anomaly_type": string,"auto_resolved": boolean,"dedupe_key": string,"detected_at": string,"driver_id": string | null,"expected_value": string | null,"franchise_id": string | null,"id": string,"metric": NonNullable<Json>,"severity": string,"status": string,"status_changed_at": string | null,"status_changed_by": string | null,"status_note": string | null,"subject_date": string,"suggested_action": string,"title": string,"what_happened": string,"why_flagged": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"actual_value"?: string | null,"anomaly_type": string,"auto_resolved"?: boolean,"dedupe_key": string,"detected_at"?: string,"driver_id"?: string | null,"expected_value"?: string | null,"franchise_id"?: string | null,"id"?: string,"metric"?: NonNullable<Json>,"severity"?: string,"status"?: string,"status_changed_at"?: string | null,"status_changed_by"?: string | null,"status_note"?: string | null,"subject_date": string,"suggested_action": string,"title": string,"what_happened": string,"why_flagged": string
                  }
                  Update: {
                    "account_id"?: string,"actual_value"?: string | null,"anomaly_type"?: string,"auto_resolved"?: boolean,"dedupe_key"?: string,"detected_at"?: string,"driver_id"?: string | null,"expected_value"?: string | null,"franchise_id"?: string | null,"id"?: string,"metric"?: NonNullable<Json>,"severity"?: string,"status"?: string,"status_changed_at"?: string | null,"status_changed_by"?: string | null,"status_note"?: string | null,"subject_date"?: string,"suggested_action"?: string,"title"?: string,"what_happened"?: string,"why_flagged"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "anomalies_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anomalies_driver_id_fkey"
      columns: ["driver_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "anomalies_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    }
                  ]
                },"app_settings": {
                  Row: {
                    "account_id": string,"anomaly_config": NonNullable<Json>,"auto_monthly_reports": boolean,"earnings_meaning": string,"report_frequency": string,"revenue_allocation_basis": string,"sync_enabled": boolean,"sync_time_local": string,"sync_timezone": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"anomaly_config"?: NonNullable<Json>,"auto_monthly_reports"?: boolean,"earnings_meaning"?: string,"report_frequency"?: string,"revenue_allocation_basis"?: string,"sync_enabled"?: boolean,"sync_time_local"?: string,"sync_timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"anomaly_config"?: NonNullable<Json>,"auto_monthly_reports"?: boolean,"earnings_meaning"?: string,"report_frequency"?: string,"revenue_allocation_basis"?: string,"sync_enabled"?: boolean,"sync_time_local"?: string,"sync_timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "app_settings_account_id_fkey"
      columns: ["account_id"]
isOneToOne: true
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "account_id": string,"action": string,"actor_id": string | null,"actor_type": string,"after": Json | null,"before": Json | null,"created_at": string,"entity_id": string | null,"entity_table": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"action": string,"actor_id"?: string | null,"actor_type": string,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_table": string,"id"?: never
                  }
                  Update: {
                    "account_id"?: string,"action"?: string,"actor_id"?: string | null,"actor_type"?: string,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_table"?: string,"id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_earnings": {
                  Row: {
                    "account_id": string,"additional_payments": number,"created_at": string,"deductions": number,"driver_id": string | null,"driver_key": string,"extracted_at": string,"extraction_confidence": number | null,"excess_parcels": number | null,"mileage": number | null,"stop_pay": number | null,"parcel_pay": number | null,"franchise_id": string,"gross_earnings": number,"id": string,"imported_file_id": string,"is_current": boolean,"net_earnings": number | null,"original_earnings": number | null,"parcels": number | null,"pay_per_parcel": number | null,"pay_per_stop": number | null,"report_date": string,"route": string | null,"source": string,"source_driver_name": string,"source_driver_ref": string | null,"stops": number | null,"superseded_at": string | null,"superseded_by": string | null,"superseded_reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"additional_payments"?: number,"created_at"?: string,"deductions"?: number,"driver_id"?: string | null,"driver_key": string,"extracted_at"?: string,"extraction_confidence"?: number | null,"excess_parcels"?: number | null,"mileage"?: number | null,"stop_pay"?: number | null,"parcel_pay"?: number | null,"franchise_id": string,"gross_earnings": number,"id"?: string,"imported_file_id": string,"is_current"?: boolean,"net_earnings"?: number | null,"original_earnings"?: never,"parcels"?: number | null,"pay_per_parcel"?: number | null,"pay_per_stop"?: number | null,"report_date": string,"route"?: string | null,"source": string,"source_driver_name": string,"source_driver_ref"?: string | null,"stops"?: number | null,"superseded_at"?: string | null,"superseded_by"?: string | null,"superseded_reason"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"additional_payments"?: number,"created_at"?: string,"deductions"?: number,"driver_id"?: string | null,"driver_key"?: string,"extracted_at"?: string,"extraction_confidence"?: number | null,"excess_parcels"?: number | null,"mileage"?: number | null,"stop_pay"?: number | null,"parcel_pay"?: number | null,"franchise_id"?: string,"gross_earnings"?: number,"id"?: string,"imported_file_id"?: string,"is_current"?: boolean,"net_earnings"?: number | null,"original_earnings"?: never,"parcels"?: number | null,"pay_per_parcel"?: number | null,"pay_per_stop"?: number | null,"report_date"?: string,"route"?: string | null,"source"?: string,"source_driver_name"?: string,"source_driver_ref"?: string | null,"stops"?: number | null,"superseded_at"?: string | null,"superseded_by"?: string | null,"superseded_reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_earnings_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_earnings_driver_id_account_id_fkey"
      columns: ["driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "daily_earnings_franchise_id_account_id_fkey"
      columns: ["franchise_id","account_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "daily_earnings_imported_file_id_fkey"
      columns: ["imported_file_id"]
isOneToOne: false
      referencedRelation: "imported_files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_earnings_superseded_by_fkey"
      columns: ["superseded_by"]
isOneToOne: false
      referencedRelation: "daily_earnings"
      referencedColumns: ["id"]
    }
                  ]
                },"dpd_invoices": {
                  Row: {
                    "account_id": string,"created_at": string,"due_date": string | null,"franchise_id": string,"id": string,"invoice_date": string,"invoice_no": string,"invoice_total": number,"lines": NonNullable<Json>,"net_total": number,"period_end": string,"period_start": string,"problems": NonNullable<Json>,"reconciled": boolean,"vat_total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"due_date"?: string | null,"franchise_id": string,"id"?: string,"invoice_date": string,"invoice_no": string,"invoice_total": number,"lines": NonNullable<Json>,"net_total": number,"period_end": string,"period_start": string,"problems"?: NonNullable<Json>,"reconciled": boolean,"vat_total": number
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"due_date"?: string | null,"franchise_id"?: string,"id"?: string,"invoice_date"?: string,"invoice_no"?: string,"invoice_total"?: number,"lines"?: NonNullable<Json>,"net_total"?: number,"period_end"?: string,"period_start"?: string,"problems"?: NonNullable<Json>,"reconciled"?: boolean,"vat_total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "dpd_invoices_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dpd_invoices_franchise_id_account_id_fkey"
      columns: ["franchise_id","account_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id","account_id"]
    }
                  ]
                },"driver_aliases": {
                  Row: {
                    "account_id": string,"alias_display": string,"alias_normalised": string,"created_at": string,"driver_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"alias_display": string,"alias_normalised": string,"created_at"?: string,"driver_id": string,"id"?: string
                  }
                  Update: {
                    "account_id"?: string,"alias_display"?: string,"alias_normalised"?: string,"created_at"?: string,"driver_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_aliases_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "driver_aliases_driver_id_account_id_fkey"
      columns: ["driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    }
                  ]
                },"user_billing": {
                  Row: {
                    "cancel_at_period_end": boolean,"current_period_end": string | null,"status": string,"stripe_customer_id": string | null,"stripe_subscription_id": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_at_period_end"?: boolean,"current_period_end"?: string | null,"status"?: string,"stripe_customer_id"?: string | null,"stripe_subscription_id"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "cancel_at_period_end"?: boolean,"current_period_end"?: string | null,"status"?: string,"stripe_customer_id"?: string | null,"stripe_subscription_id"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: []
                },"account_closure_requests": {
                  Row: {
                    "account_id": string,"completed_at": string | null,"id": string,"note": string | null,"requested_at": string,"requested_by": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"completed_at"?: string | null,"id"?: string,"note"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"status"?: string
                  }
                  Update: {
                    "account_id"?: string,"completed_at"?: string | null,"id"?: string,"note"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"status"?: string
                  }
                  Relationships: []
                },"dpd_logins": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"id": string,"label": string,"last_error": string | null,"last_success_at": string | null,"username": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label": string,"last_error"?: string | null,"last_success_at"?: string | null,"username": string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label"?: string,"last_error"?: string | null,"last_success_at"?: string | null,"username"?: string
                  }
                  Relationships: []
                },"sliding_scale_rates": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"fuel_type": string,"id": string,"miles_from": number | null,"miles_to": number | null,"note": string | null,"rate": number,"stops_from": number,"stops_to": number | null,"vehicle_size": string | null,"vehicle_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"fuel_type"?: string,"id"?: string,"miles_from"?: number | null,"miles_to"?: number | null,"note"?: string | null,"rate": number,"stops_from": number,"stops_to"?: number | null,"vehicle_size"?: string | null,"vehicle_type": string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"fuel_type"?: string,"id"?: string,"miles_from"?: number | null,"miles_to"?: number | null,"note"?: string | null,"rate"?: number,"stops_from"?: number,"stops_to"?: number | null,"vehicle_size"?: string | null,"vehicle_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sliding_scale_rates_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"driver_day_rates": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"day_rate": number,"pay_basis": string,"driver_id": string,"effective_from": string,"id": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"day_rate": number,"pay_basis"?: string,"driver_id": string,"effective_from": string,"id"?: string,"note"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"day_rate"?: number,"pay_basis"?: string,"driver_id"?: string,"effective_from"?: string,"id"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_day_rates_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "driver_day_rates_driver_id_account_id_fkey"
      columns: ["driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    }
                  ]
                },"driver_assignments": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"driver_id": string,"end_date": string | null,"franchise_id": string,"id": string,"notes": string | null,"route": string | null,"start_date": string,"updated_at": string,"vehicle_registration": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"driver_id": string,"end_date"?: string | null,"franchise_id": string,"id"?: string,"notes"?: string | null,"route"?: string | null,"start_date": string,"updated_at"?: string,"vehicle_registration"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"driver_id"?: string,"end_date"?: string | null,"franchise_id"?: string,"id"?: string,"notes"?: string | null,"route"?: string | null,"start_date"?: string,"updated_at"?: string,"vehicle_registration"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_assignments_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "driver_assignments_driver_id_account_id_fkey"
      columns: ["driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "driver_assignments_franchise_id_account_id_fkey"
      columns: ["franchise_id","account_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id","account_id"]
    }
                  ]
                },"driver_cover_records": {
                  Row: {
                    "account_id": string,"amount_from_original": number,"amount_to_covering": number,"cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"cover_date": string,"covering_driver_id": string,"created_at": string,"created_by": string,"earnings_allocation": string,"expense_attribution": string,"franchise_id": string,"id": string,"notes": string | null,"original_driver_id": string,"route": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_from_original"?: number,"amount_to_covering"?: number,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"cover_date": string,"covering_driver_id": string,"created_at"?: string,"created_by": string,"earnings_allocation"?: string,"expense_attribution"?: string,"franchise_id": string,"id"?: string,"notes"?: string | null,"original_driver_id": string,"route"?: string | null,"status"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_from_original"?: number,"amount_to_covering"?: number,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"cover_date"?: string,"covering_driver_id"?: string,"created_at"?: string,"created_by"?: string,"earnings_allocation"?: string,"expense_attribution"?: string,"franchise_id"?: string,"id"?: string,"notes"?: string | null,"original_driver_id"?: string,"route"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "driver_cover_records_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "driver_cover_records_covering_driver_id_account_id_fkey"
      columns: ["covering_driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "driver_cover_records_franchise_id_account_id_fkey"
      columns: ["franchise_id","account_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "driver_cover_records_original_driver_id_account_id_fkey"
      columns: ["original_driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    }
                  ]
                },"drivers": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"display_name": string,"dpd_driver_ref": string | null,"email": string | null,"id": string,"is_active": boolean,"leaving_date": string | null,"notes": string | null,"phone": string | null,"start_date": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"display_name": string,"dpd_driver_ref"?: string | null,"email"?: string | null,"id"?: string,"is_active"?: boolean,"leaving_date"?: string | null,"notes"?: string | null,"phone"?: string | null,"start_date"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"display_name"?: string,"dpd_driver_ref"?: string | null,"email"?: string | null,"id"?: string,"is_active"?: boolean,"leaving_date"?: string | null,"notes"?: string | null,"phone"?: string | null,"start_date"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "drivers_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"earnings_adjustments": {
                  Row: {
                    "account_id": string,"adjustment_type": string,"amount": number,"cover_record_id": string | null,"created_at": string,"created_by": string,"driver_id": string,"earnings_date": string,"franchise_id": string,"id": string,"reason": string,"reverses_adjustment_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"adjustment_type": string,"amount": number,"cover_record_id"?: string | null,"created_at"?: string,"created_by": string,"driver_id": string,"earnings_date": string,"franchise_id": string,"id"?: string,"reason": string,"reverses_adjustment_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"adjustment_type"?: string,"amount"?: number,"cover_record_id"?: string | null,"created_at"?: string,"created_by"?: string,"driver_id"?: string,"earnings_date"?: string,"franchise_id"?: string,"id"?: string,"reason"?: string,"reverses_adjustment_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "earnings_adjustments_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "earnings_adjustments_cover_record_id_fkey"
      columns: ["cover_record_id"]
isOneToOne: false
      referencedRelation: "driver_cover_records"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "earnings_adjustments_driver_id_account_id_fkey"
      columns: ["driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "earnings_adjustments_franchise_id_account_id_fkey"
      columns: ["franchise_id","account_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "earnings_adjustments_reverses_adjustment_id_fkey"
      columns: ["reverses_adjustment_id"]
isOneToOne: false
      referencedRelation: "earnings_adjustments"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_allocations": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"driver_id": string | null,"expense_id": string | null,"fuel_transaction_id": string | null,"id": string,"is_current": boolean,"method": string,"note": string | null,"replaced_at": string | null,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"driver_id"?: string | null,"expense_id"?: string | null,"fuel_transaction_id"?: string | null,"id"?: string,"is_current"?: boolean,"method": string,"note"?: string | null,"replaced_at"?: string | null,"scope": string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"driver_id"?: string | null,"expense_id"?: string | null,"fuel_transaction_id"?: string | null,"id"?: string,"is_current"?: boolean,"method"?: string,"note"?: string | null,"replaced_at"?: string | null,"scope"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_allocations_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_allocations_driver_id_account_id_fkey"
      columns: ["driver_id","account_id"]
isOneToOne: false
      referencedRelation: "drivers"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "expense_allocations_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_allocations_fuel_transaction_id_fkey"
      columns: ["fuel_transaction_id"]
isOneToOne: false
      referencedRelation: "fuel_transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_categories": {
                  Row: {
                    "account_id": string,"created_at": string,"id": string,"is_active": boolean,"is_system": boolean,"kind": string,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"is_system"?: boolean,"kind"?: string,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"is_system"?: boolean,"kind"?: string,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_categories_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "account_id": string,"amount": number,"category_id": string,"created_at": string,"created_by": string | null,"dedupe_key": string,"description": string,"expense_date": string,"franchise_id": string | null,"id": string,"imported_file_id": string | null,"is_void": boolean,"source": string,"source_driver_name": string | null,"supplier": string | null,"transaction_ref": string | null,"vehicle_registration": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount": number,"category_id": string,"created_at"?: string,"created_by"?: string | null,"dedupe_key": string,"description"?: string,"expense_date": string,"franchise_id"?: string | null,"id"?: string,"imported_file_id"?: string | null,"is_void"?: boolean,"source": string,"source_driver_name"?: string | null,"supplier"?: string | null,"transaction_ref"?: string | null,"vehicle_registration"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"amount"?: number,"category_id"?: string,"created_at"?: string,"created_by"?: string | null,"dedupe_key"?: string,"description"?: string,"expense_date"?: string,"franchise_id"?: string | null,"id"?: string,"imported_file_id"?: string | null,"is_void"?: boolean,"source"?: string,"source_driver_name"?: string | null,"supplier"?: string | null,"transaction_ref"?: string | null,"vehicle_registration"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_category_id_account_id_fkey"
      columns: ["category_id","account_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "expenses_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_imported_file_id_fkey"
      columns: ["imported_file_id"]
isOneToOne: false
      referencedRelation: "imported_files"
      referencedColumns: ["id"]
    }
                  ]
                },"franchises": {
                  Row: {
                    "account_id": string,"created_at": string,"depot": string | null,"dpd_login_id": string | null,"fd_number": string,"id": string,"is_active": boolean,"name": string,"notes": string | null,"updated_at": string,"vehicle_fuel": string | null,"vehicle_size": string | null,"vehicle_type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"depot"?: string | null,"dpd_login_id"?: string | null,"fd_number": string,"id"?: string,"is_active"?: boolean,"name"?: string,"notes"?: string | null,"updated_at"?: string,"vehicle_fuel"?: string | null,"vehicle_size"?: string | null,"vehicle_type"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"depot"?: string | null,"dpd_login_id"?: string | null,"fd_number"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"notes"?: string | null,"updated_at"?: string,"vehicle_fuel"?: string | null,"vehicle_size"?: string | null,"vehicle_type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "franchises_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"fuel_transactions": {
                  Row: {
                    "account_id": string,"card_reference": string | null,"created_at": string,"created_by": string | null,"dedupe_key": string,"description": string | null,"franchise_id": string | null,"id": string,"imported_file_id": string | null,"is_void": boolean,"litres": number | null,"price_per_litre": number | null,"source": string,"source_driver_name": string | null,"supplier": string | null,"total_cost": number,"transaction_date": string,"transaction_ref": string | null,"transaction_time": string | null,"vehicle_registration": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"card_reference"?: string | null,"created_at"?: string,"created_by"?: string | null,"dedupe_key": string,"description"?: string | null,"franchise_id"?: string | null,"id"?: string,"imported_file_id"?: string | null,"is_void"?: boolean,"litres"?: number | null,"price_per_litre"?: number | null,"source": string,"source_driver_name"?: string | null,"supplier"?: string | null,"total_cost": number,"transaction_date": string,"transaction_ref"?: string | null,"transaction_time"?: string | null,"vehicle_registration"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"card_reference"?: string | null,"created_at"?: string,"created_by"?: string | null,"dedupe_key"?: string,"description"?: string | null,"franchise_id"?: string | null,"id"?: string,"imported_file_id"?: string | null,"is_void"?: boolean,"litres"?: number | null,"price_per_litre"?: number | null,"source"?: string,"source_driver_name"?: string | null,"supplier"?: string | null,"total_cost"?: number,"transaction_date"?: string,"transaction_ref"?: string | null,"transaction_time"?: string | null,"vehicle_registration"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fuel_transactions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuel_transactions_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuel_transactions_imported_file_id_fkey"
      columns: ["imported_file_id"]
isOneToOne: false
      referencedRelation: "imported_files"
      referencedColumns: ["id"]
    }
                  ]
                },"import_jobs": {
                  Row: {
                    "account_id": string,"attempts": number,"created_at": string,"error_detail": Json | null,"error_message": string | null,"finished_at": string | null,"franchise_id": string | null,"id": string,"job_type": string,"locked_at": string | null,"locked_by": string | null,"max_attempts": number,"payload": NonNullable<Json>,"report_date": string | null,"requested_by": string | null,"result": Json | null,"run_after": string,"started_at": string | null,"status": string,"trigger": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"attempts"?: number,"created_at"?: string,"error_detail"?: Json | null,"error_message"?: string | null,"finished_at"?: string | null,"franchise_id"?: string | null,"id"?: string,"job_type": string,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"report_date"?: string | null,"requested_by"?: string | null,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: string,"trigger"?: string
                  }
                  Update: {
                    "account_id"?: string,"attempts"?: number,"created_at"?: string,"error_detail"?: Json | null,"error_message"?: string | null,"finished_at"?: string | null,"franchise_id"?: string | null,"id"?: string,"job_type"?: string,"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"report_date"?: string | null,"requested_by"?: string | null,"result"?: Json | null,"run_after"?: string,"started_at"?: string | null,"status"?: string,"trigger"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_jobs_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_jobs_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    }
                  ]
                },"imported_files": {
                  Row: {
                    "account_id": string,"byte_size": number,"created_at": string,"document_type": string,"error_detail": Json | null,"franchise_id": string | null,"id": string,"import_job_id": string | null,"mime_type": string | null,"original_filename": string,"parse_confidence": number | null,"parser": string | null,"processed_at": string | null,"records_found": number,"records_imported": number,"records_unchanged": number,"report_date_from": string | null,"report_date_to": string | null,"sha256": string,"source": string,"source_ref": string | null,"status": string,"status_message": string | null,"storage_path": string | null,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"byte_size": number,"created_at"?: string,"document_type"?: string,"error_detail"?: Json | null,"franchise_id"?: string | null,"id"?: string,"import_job_id"?: string | null,"mime_type"?: string | null,"original_filename": string,"parse_confidence"?: number | null,"parser"?: string | null,"processed_at"?: string | null,"records_found"?: number,"records_imported"?: number,"records_unchanged"?: number,"report_date_from"?: string | null,"report_date_to"?: string | null,"sha256": string,"source": string,"source_ref"?: string | null,"status"?: string,"status_message"?: string | null,"storage_path"?: string | null,"uploaded_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"byte_size"?: number,"created_at"?: string,"document_type"?: string,"error_detail"?: Json | null,"franchise_id"?: string | null,"id"?: string,"import_job_id"?: string | null,"mime_type"?: string | null,"original_filename"?: string,"parse_confidence"?: number | null,"parser"?: string | null,"processed_at"?: string | null,"records_found"?: number,"records_imported"?: number,"records_unchanged"?: number,"report_date_from"?: string | null,"report_date_to"?: string | null,"sha256"?: string,"source"?: string,"source_ref"?: string | null,"status"?: string,"status_message"?: string | null,"storage_path"?: string | null,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "imported_files_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "imported_files_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "imported_files_import_job_id_fkey"
      columns: ["import_job_id"]
isOneToOne: false
      referencedRelation: "import_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_connections": {
                  Row: {
                    "account_id": string,"config": NonNullable<Json>,"created_at": string,"created_by": string | null,"display_name": string | null,"external_account_id": string | null,"id": string,"last_error": string | null,"last_success_at": string | null,"last_sync_at": string | null,"provider": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"display_name"?: string | null,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_success_at"?: string | null,"last_sync_at"?: string | null,"provider": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"config"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"display_name"?: string | null,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_success_at"?: string | null,"last_sync_at"?: string | null,"provider"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_connections_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_folders": {
                  Row: {
                    "account_id": string,"connection_id": string,"created_at": string,"created_by": string | null,"cursor": string | null,"default_franchise_id": string | null,"id": string,"last_checked_at": string | null,"path_display": string,"path_lower": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"connection_id": string,"created_at"?: string,"created_by"?: string | null,"cursor"?: string | null,"default_franchise_id"?: string | null,"id"?: string,"last_checked_at"?: string | null,"path_display": string,"path_lower": string
                  }
                  Update: {
                    "account_id"?: string,"connection_id"?: string,"created_at"?: string,"created_by"?: string | null,"cursor"?: string | null,"default_franchise_id"?: string | null,"id"?: string,"last_checked_at"?: string | null,"path_display"?: string,"path_lower"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_folders_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "integration_folders_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "integration_connections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "integration_folders_default_franchise_id_fkey"
      columns: ["default_franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    }
                  ]
                },"monthly_reports": {
                  Row: {
                    "account_id": string,"franchise_id": string | null,"generated_at": string,"generated_by": string | null,"id": string,"period_end": string | null,"period_start": string | null,"report_month": string,"storage_path": string,"totals": NonNullable<Json>,"trigger": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"franchise_id"?: string | null,"generated_at"?: string,"generated_by"?: string | null,"id"?: string,"period_end"?: string | null,"period_start"?: string | null,"report_month": string,"storage_path": string,"totals"?: NonNullable<Json>,"trigger"?: string
                  }
                  Update: {
                    "account_id"?: string,"franchise_id"?: string | null,"generated_at"?: string,"generated_by"?: string | null,"id"?: string,"period_end"?: string | null,"period_start"?: string | null,"report_month"?: string,"storage_path"?: string,"totals"?: NonNullable<Json>,"trigger"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "monthly_reports_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "monthly_reports_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    }
                  ]
                },"revenue_entries": {
                  Row: {
                    "account_id": string,"amount": number,"created_at": string,"created_by": string | null,"description": string | null,"franchise_id": string,"id": string,"imported_file_id": string | null,"is_void": boolean,"period_end": string,"period_start": string,"source": string,"status": string,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount": number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"franchise_id": string,"id"?: string,"imported_file_id"?: string | null,"is_void"?: boolean,"period_end": string,"period_start": string,"source"?: string,"status"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"amount"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"franchise_id"?: string,"id"?: string,"imported_file_id"?: string | null,"is_void"?: boolean,"period_end"?: string,"period_start"?: string,"source"?: string,"status"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "revenue_entries_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "revenue_entries_franchise_id_account_id_fkey"
      columns: ["franchise_id","account_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id","account_id"]
    },{
      foreignKeyName: "revenue_entries_imported_file_id_fkey"
      columns: ["imported_file_id"]
isOneToOne: false
      referencedRelation: "imported_files"
      referencedColumns: ["id"]
    }
                  ]
                },"review_items": {
                  Row: {
                    "account_id": string,"created_at": string,"dedupe_key": string | null,"detail": string,"franchise_id": string | null,"id": string,"imported_file_id": string | null,"kind": string,"payload": NonNullable<Json>,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"dedupe_key"?: string | null,"detail"?: string,"franchise_id"?: string | null,"id"?: string,"imported_file_id"?: string | null,"kind": string,"payload"?: NonNullable<Json>,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"title": string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"dedupe_key"?: string | null,"detail"?: string,"franchise_id"?: string | null,"id"?: string,"imported_file_id"?: string | null,"kind"?: string,"payload"?: NonNullable<Json>,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_items_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "review_items_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "review_items_imported_file_id_fkey"
      columns: ["imported_file_id"]
isOneToOne: false
      referencedRelation: "imported_files"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_logs": {
                  Row: {
                    "account_id": string,"created_at": string,"detail": Json | null,"event": string,"franchise_id": string | null,"id": string,"import_job_id": string | null,"integration": string,"level": string,"message": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"detail"?: Json | null,"event": string,"franchise_id"?: string | null,"id"?: string,"import_job_id"?: string | null,"integration": string,"level"?: string,"message": string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"detail"?: Json | null,"event"?: string,"franchise_id"?: string | null,"id"?: string,"import_job_id"?: string | null,"integration"?: string,"level"?: string,"message"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_logs_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sync_logs_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sync_logs_import_job_id_fkey"
      columns: ["import_job_id"]
isOneToOne: false
      referencedRelation: "import_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"user_franchise_access": {
                  Row: {
                    "created_at": string,"franchise_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"franchise_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"franchise_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_franchise_access_franchise_id_fkey"
      columns: ["franchise_id"]
isOneToOne: false
      referencedRelation: "franchises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_franchise_access_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_profiles": {
                  Row: {
                    "account_id": string,"all_franchises": boolean,"created_at": string,"full_name": string,"id": string,"role": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"all_franchises"?: boolean,"created_at"?: string,"full_name"?: string,"id": string,"role"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"all_franchises"?: boolean,"created_at"?: string,"full_name"?: string,"id"?: string,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_profiles_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "read_dpd_login_secret":
{ Args: { "p_login_id": string }; Returns: string
                           },
            "save_dpd_login_secret":
{ Args: { "p_login_id": string,"p_ciphertext": string }; Returns: undefined
                           },
            "billing_allows_access":
{ Args: Record<string, never>; Returns: boolean
                           },
"bootstrap_account":
{ Args: { "p_business_name": string,"p_full_name": string }; Returns: string
                           },
"cancel_driver_cover":
{ Args: { "p_cover_id": string,"p_reason": string }; Returns: {
              "account_id": string,
"amount_from_original": number,
"amount_to_covering": number,
"cancel_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"cover_date": string,
"covering_driver_id": string,
"created_at": string,
"created_by": string,
"earnings_allocation": string,
"expense_attribution": string,
"franchise_id": string,
"id": string,
"notes": string | null,
"original_driver_id": string,
"route": string | null,
"status": string
            }
                          SetofOptions: {
        from: "*"
        to: "driver_cover_records"
        isOneToOne: true
        isSetofReturn: false
      } },
"claim_next_job":
{ Args: { "p_types": (string)[],"p_worker": string }; Returns: {
              "account_id": string,
"attempts": number,
"created_at": string,
"error_detail": Json | null,
"error_message": string | null,
"finished_at": string | null,
"franchise_id": string | null,
"id": string,
"job_type": string,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"report_date": string | null,
"requested_by": string | null,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"trigger": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "import_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"create_pay_adjustment":
{ Args: { "p_amount": number,"p_driver_id": string,"p_earnings_date": string,"p_franchise_id": string,"p_reason": string,"p_type": string }; Returns: {
              "account_id": string,
"adjustment_type": string,
"amount": number,
"cover_record_id": string | null,
"created_at": string,
"created_by": string,
"driver_id": string,
"earnings_date": string,
"franchise_id": string,
"id": string,
"reason": string,
"reverses_adjustment_id": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "earnings_adjustments"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_integration_secret":
{ Args: { "p_connection_id": string }; Returns: undefined
                           },
"enqueue_job":
{ Args: { "p_account_id": string,"p_franchise_id": string,"p_job_type": string,"p_payload": Json,"p_report_date": string,"p_requested_by": string,"p_trigger": string }; Returns: {
              "account_id": string,
"attempts": number,
"created_at": string,
"error_detail": Json | null,
"error_message": string | null,
"finished_at": string | null,
"franchise_id": string | null,
"id": string,
"job_type": string,
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"report_date": string | null,
"requested_by": string | null,
"result": Json | null,
"run_after": string,
"started_at": string | null,
"status": string,
"trigger": string
            }
                          SetofOptions: {
        from: "*"
        to: "import_jobs"
        isOneToOne: true
        isSetofReturn: false
      } },
"ingest_earnings":
{ Args: { "p_file_id": string,"p_rows": Json }; Returns: Json
                           },
"ingest_expenses":
{ Args: { "p_file_id": string,"p_rows": Json }; Returns: Json
                           },
"ingest_fuel":
{ Args: { "p_file_id": string,"p_rows": Json }; Returns: Json
                           },
"link_earnings_to_driver":
{ Args: { "p_alias": string,"p_driver_id": string,"p_driver_key": string,"p_franchise_id": string }; Returns: number
                           },
"read_integration_secret":
{ Args: { "p_connection_id": string }; Returns: string
                           },
"record_driver_cover":
{ Args: { "p_amount_from_original": number,"p_amount_to_covering": number,"p_cover_date": string,"p_covering_driver_id": string,"p_earnings_allocation": string,"p_expense_attribution": string,"p_franchise_id": string,"p_notes": string,"p_original_driver_id": string,"p_route": string }; Returns: {
              "account_id": string,
"amount_from_original": number,
"amount_to_covering": number,
"cancel_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"cover_date": string,
"covering_driver_id": string,
"created_at": string,
"created_by": string,
"earnings_allocation": string,
"expense_attribution": string,
"franchise_id": string,
"id": string,
"notes": string | null,
"original_driver_id": string,
"route": string | null,
"status": string
            }
                          SetofOptions: {
        from: "*"
        to: "driver_cover_records"
        isOneToOne: true
        isSetofReturn: false
      } },
"release_stale_jobs":
{ Args: { "p_older_than": string }; Returns: number
                           },
"resolve_earnings_conflict":
{ Args: { "p_choice": string,"p_note": string,"p_review_item_id": string }; Returns: undefined
                           },
"reverse_pay_adjustment":
{ Args: { "p_adjustment_id": string,"p_reason": string }; Returns: {
              "account_id": string,
"adjustment_type": string,
"amount": number,
"cover_record_id": string | null,
"created_at": string,
"created_by": string,
"driver_id": string,
"earnings_date": string,
"franchise_id": string,
"id": string,
"reason": string,
"reverses_adjustment_id": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "earnings_adjustments"
        isOneToOne: true
        isSetofReturn: false
      } },
"save_integration_secret":
{ Args: { "p_ciphertext": string,"p_connection_id": string }; Returns: undefined
                           },
"set_cost_allocation":
{ Args: { "p_cost_id": string,"p_driver_id": string,"p_kind": string,"p_note": string,"p_scope": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
