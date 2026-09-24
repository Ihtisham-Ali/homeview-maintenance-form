// Relay for Homeview Property Group maintenance report form.
// 1. Receives clean JSON submission with file URLs already uploaded to Supabase Storage.
// 2. Inserts submission record into Supabase PostgreSQL (homereview_submissions).
// 3. Forwards pure JSON payload (with public file_urls) to Make.com webhook.
// 4. Updates webhook delivery status in Supabase.

export const config = { runtime: "edge" };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://uymidpurzgjqzmqssjuc.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5bWlkcHVyemdqcXptcXNzanVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjA2OTYsImV4cCI6MjEwNTgzNjY5Nn0.cAhbIiaM4lZxcz8IBxD4We6VRB7_j_2TXMYEaJy8VV0";
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "homereview_submissions";
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || "https://hook.eu1.make.com/9nwpq3h5eheub2qaoxn1vmbxd4n81got";

export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    let payload = null;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const dataStr = formData.get("data") || formData.get("payload");
      if (dataStr) {
        try {
          payload = JSON.parse(dataStr);
        } catch (_) {
          payload = {};
        }
      } else {
        payload = Object.fromEntries(formData.entries());
      }
    } else {
      try {
        payload = await request.json();
      } catch (_) {
        payload = {};
      }
    }

    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ ok: false, error: "Invalid payload format" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const name = String(payload.name || payload.full_name || "").trim();
    const email = String(payload.email || payload.user_email || "").trim();

    if (!name || !email) {
      return new Response(JSON.stringify({ ok: false, error: "Name and email are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Ensure company and source identifiers reflect Homeview
    payload.company_name = payload.company_name || "Homeview Property Management";
    payload.company = payload.company || "Homeview Property Management";
    payload.brand = payload.brand || "Homeview Property Management";
    payload.source = payload.source || "Homeview Maintenance Portal";

    const fileUrls = Array.isArray(payload.file_urls) ? payload.file_urls : [];

    const fullAddress = String(
      payload.full_address ||
      (payload.flat_room_number ? `${payload.flat_room_number}, ${payload.address || ""}` : (payload.address || ""))
    ).trim();

    const dbRecord = {
      company_name: String(payload.company_name || "Homeview Property Management"),
      source: String(payload.source || "Homeview Maintenance Portal"),
      name: name,
      email: email,
      phone: String(payload.phone || ""),
      address: String(payload.address || ""),
      flat_room_number: String(payload.flat_room_number || ""),
      full_address: fullAddress,
      city: String(payload.city || ""),
      postcode: String(payload.postcode || ""),
      category_id: String(payload.category_id || ""),
      category_label: String(payload.category_label || ""),
      issue_code: String(payload.issue_code || ""),
      issue_label: String(payload.issue_label || ""),
      other_issue_text: String(payload.other_issue_text || ""),
      further_info: String(payload.further_info || ""),
      priority: String(payload.priority || "routine"),
      internal_priority: String(payload.internal_priority || "normal"),
      keys_allowed: String(payload.keys_allowed || ""),
      has_pets: String(payload.has_pets || ""),
      pets_details: String(payload.pets_details || ""),
      preferred_appointment_slots: String(payload.preferred_appointment_slots || ""),
      access_instructions: String(payload.access_instructions || ""),
      troubleshooting_summary: String(payload.troubleshooting_summary || ""),
      troubleshooting_answers: payload.troubleshooting_answers || {},
      troubleshooting_path: Array.isArray(payload.troubleshooting_path) ? payload.troubleshooting_path : [],
      boiler_error_code: String(payload.boiler_error_code || ""),
      engineer_required: Boolean(payload.engineer_required || false),
      request_closed: Boolean(payload.request_closed || false),
      responsibility_type: String(payload.responsibility_type || ""),
      alert_type: String(payload.alert_type || ""),
      final_action: String(payload.final_action || ""),
      file_urls: fileUrls,
      file_count: fileUrls.length,
      submitted_at: String(payload.submitted_at || new Date().toISOString()),
      make_webhook_sent: false
    };

    // 1. Insert record into Supabase PostgreSQL (if not already inserted by client)
    let insertedId = payload.supabase_id || null;
    if (!insertedId) {
      try {
        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Prefer": "return=representation"
          },
          body: JSON.stringify(dbRecord)
        });

        if (sbRes.ok) {
          const sbData = await sbRes.json();
          if (Array.isArray(sbData) && sbData[0] && sbData[0].id) {
            insertedId = sbData[0].id;
          }
        } else {
          const errText = await sbRes.text();
          console.error("[Supabase Insert Error]", sbRes.status, errText);
        }
      } catch (sbErr) {
        console.error("[Supabase Insert Exception]", sbErr.message);
      }
    }

    // 2. Forward clean JSON payload (with public file_urls) to Make.com Webhook
    let webhookSuccess = false;
    let webhookStatus = 0;
    let webhookError = null;

    try {
      const makeRes = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      webhookStatus = makeRes.status;
      webhookSuccess = makeRes.ok;
      if (!makeRes.ok) {
        webhookError = `Make.com returned status ${makeRes.status}`;
        console.warn("[Make.com Webhook Non-200]", makeRes.status);
      }
    } catch (makeErr) {
      webhookError = makeErr.message || "Failed to reach Make.com webhook";
      console.error("[Make.com Webhook Exception]", makeErr.message);
    }

    // 3. Update Supabase record with webhook delivery status
    if (insertedId) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${insertedId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            make_webhook_sent: webhookSuccess,
            make_webhook_status: webhookStatus,
            make_webhook_error: webhookError
          })
        });
      } catch (_) {}
    }

    // If either Supabase or Webhook succeeded, treat as successful submission
    if (webhookSuccess || insertedId) {
      return new Response(JSON.stringify({ ok: true, id: insertedId }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } else {
      return new Response(JSON.stringify({ ok: false, error: webhookError || "Submission delivery failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

  } catch (err) {
    console.error("[Relay Fatal Error]", err);
    return new Response(JSON.stringify({ ok: false, error: "Internal relay error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
