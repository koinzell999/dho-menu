/* ── DHO Menu – Cloud Functions ───────────────────────── */
"use strict";

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
const fetch      = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

/* ────────────────────────────────────────────────────────
 *  analyzeDay
 *  Callable function: reads analytics/{dateKey} and its
 *  minutes/ subcollection, builds a CSV + prompt,
 *  sends to Hugging Face, returns AI summary.
 *  Saves the summary to aiSummaries/{dateKey} for history.
 * ──────────────────────────────────────────────────────── */
exports.analyzeDay = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data, context) => {

    /* ── Auth guard ─────────────────────────────────────── */
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be signed in to run analysis."
      );
    }

    const dateKey = (data && data.dateKey) || new Date().toLocaleDateString("en-CA");

    /* ── Read daily analytics document ─────────────────── */
    const daySnap    = await db.collection("analytics").doc(dateKey).get();
    const dayData    = daySnap.exists ? daySnap.data() : {};

    /* ── Read minute-level subcollection ────────────────── */
    const minuteSnap = await db
      .collection("analytics").doc(dateKey)
      .collection("minutes")
      .orderBy("__name__")
      .get();

    const minuteRows = minuteSnap.docs.map(d => ({
      time       : d.id,
      totalSales : d.data().totalSales  || 0,
      orderCount : d.data().orderCount  || 0,
    }));

    /* ── Build CSV for export ───────────────────────────── */
    const csvDaily = buildDailyCSV(dateKey, dayData);
    const csvMinutes = buildMinuteCSV(minuteRows);

    /* ── Build AI prompt ────────────────────────────────── */
    const prompt = buildPrompt(dateKey, dayData, minuteRows);

    /* ── Call Hugging Face API ──────────────────────────── */
    const hfKey = functions.config().huggingface && functions.config().huggingface.key;
    if (!hfKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Hugging Face API key not configured. Run: firebase functions:config:set huggingface.key=\"hf_YOUR_TOKEN\""
      );
    }

    let aiSummary = "";
    try {
      const hfResponse = await fetch(
        "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3",
        {
          method : "POST",
          headers: {
            "Authorization": `Bearer ${hfKey}`,
            "Content-Type" : "application/json",
          },
          body: JSON.stringify({
            inputs: `<s>[INST] ${prompt} [/INST]`,
            parameters: {
              max_new_tokens  : 600,
              temperature     : 0.3,
              return_full_text: false,
            },
          }),
        }
      );

      if (!hfResponse.ok) {
        const errText = await hfResponse.text();
        throw new Error(`HF API error ${hfResponse.status}: ${errText}`);
      }

      const hfJson = await hfResponse.json();
      // Standard text-generation response: [{generated_text: "..."}]
      aiSummary = Array.isArray(hfJson) && hfJson[0]
        ? (hfJson[0].generated_text || "").trim()
        : JSON.stringify(hfJson);

    } catch (err) {
      functions.logger.error("Hugging Face call failed:", err);
      throw new functions.https.HttpsError("internal", `AI analysis failed: ${err.message}`);
    }

    /* ── Persist result to Firestore ────────────────────── */
    await db.collection("aiSummaries").doc(dateKey).set({
      dateKey,
      summary   : aiSummary,
      csvDaily,
      csvMinutes,
      analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { aiSummary, csvDaily, csvMinutes };
  });


/* ────────────────────────────────────────────────────────
 *  scheduledAnalysis
 *  Runs at midnight (00:05) every day to auto-analyze
 *  the previous day. Saves result to aiSummaries/{date}.
 * ──────────────────────────────────────────────────────── */
exports.scheduledAnalysis = functions.pubsub
  .schedule("5 0 * * *")
  .timeZone("Europe/Istanbul")
  .onRun(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = yesterday.toLocaleDateString("en-CA");

    const hfKey = functions.config().huggingface && functions.config().huggingface.key;
    if (!hfKey) {
      functions.logger.warn("HF key not set – skipping scheduled analysis");
      return null;
    }

    const daySnap    = await db.collection("analytics").doc(dateKey).get();
    if (!daySnap.exists) { functions.logger.info("No analytics for", dateKey); return null; }
    const dayData    = daySnap.data();

    const minuteSnap = await db
      .collection("analytics").doc(dateKey)
      .collection("minutes").orderBy("__name__").get();
    const minuteRows = minuteSnap.docs.map(d => ({
      time: d.id, totalSales: d.data().totalSales || 0, orderCount: d.data().orderCount || 0,
    }));

    const prompt    = buildPrompt(dateKey, dayData, minuteRows);
    const csvDaily  = buildDailyCSV(dateKey, dayData);
    const csvMinutes = buildMinuteCSV(minuteRows);

    try {
      const hfResp = await fetch(
        "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3",
        {
          method : "POST",
          headers: { "Authorization": `Bearer ${hfKey}`, "Content-Type": "application/json" },
          body   : JSON.stringify({
            inputs    : `<s>[INST] ${prompt} [/INST]`,
            parameters: { max_new_tokens: 600, temperature: 0.3, return_full_text: false },
          }),
        }
      );
      const hfJson    = await hfResp.json();
      const aiSummary = Array.isArray(hfJson) && hfJson[0]
        ? (hfJson[0].generated_text || "").trim() : "";

      await db.collection("aiSummaries").doc(dateKey).set({
        dateKey, summary: aiSummary, csvDaily, csvMinutes,
        analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      functions.logger.info("Scheduled analysis saved for", dateKey);
    } catch (err) {
      functions.logger.error("Scheduled analysis error:", err);
    }
    return null;
  });


/* ── CSV helpers ─────────────────────────────────────────── */
function buildDailyCSV(dateKey, d) {
  const itemsSold = d.itemsSold  || {};
  const itemNames = d.itemNames  || {};
  const tables    = d.tables     || {};

  const rows = [
    ["DHO Menu – Daily Analytics", dateKey],
    [],
    ["Metric", "Value"],
    ["Total Revenue (₺)", (d.totalSales  || 0).toFixed(2)],
    ["Total Orders",       d.orderCount  || 0],
    ["Cash Sales (₺)",     (d.cashSales  || 0).toFixed(2)],
    ["Card Sales (₺)",     (d.cardSales  || 0).toFixed(2)],
    ["Cash Orders",        d.cashCount   || 0],
    ["Card Orders",        d.cardCount   || 0],
    [],
    ["Item", "Qty Sold"],
    ...Object.entries(itemsSold).map(([k, qty]) => [itemNames[k] || k, qty]),
    [],
    ["Table", "Orders", "Revenue (₺)"],
    ...Object.entries(tables).map(([t, v]) => [t, v.orders || 0, (v.sales || 0).toFixed(2)]),
  ];
  return csvEncode(rows);
}

function buildMinuteCSV(minuteRows) {
  if (!minuteRows.length) return "Time,Total Sales (₺),Order Count\n(no data)";
  return csvEncode([
    ["Time (HH:MM)", "Total Sales (₺)", "Order Count"],
    ...minuteRows.map(r => [r.time, r.totalSales.toFixed(2), r.orderCount]),
  ]);
}

function csvEncode(rows) {
  return rows.map(r =>
    (r || []).map(c => `"${String(c === undefined ? "" : c).replace(/"/g, '""')}"`).join(",")
  ).join("\n");
}

/* ── AI prompt builder ───────────────────────────────────── */
function buildPrompt(dateKey, d, minuteRows) {
  const rev        = (d.totalSales || 0).toFixed(2);
  const count      = d.orderCount  || 0;
  const cashSales  = (d.cashSales  || 0).toFixed(2);
  const cardSales  = (d.cardSales  || 0).toFixed(2);
  const itemsSold  = d.itemsSold   || {};
  const itemNames  = d.itemNames   || {};
  const tables     = d.tables      || {};

  const itemLines = Object.entries(itemsSold)
    .sort((a, b) => b[1] - a[1])
    .map(([k, qty]) => `  - ${itemNames[k] || k}: ${qty} units`)
    .join("\n") || "  (no items recorded)";

  const tableLines = Object.entries(tables)
    .map(([t, v]) => `  - ${t}: ${v.orders || 0} orders, ₺${(v.sales || 0).toFixed(0)}`)
    .join("\n") || "  (no table data)";

  const peakMinutes = minuteRows
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 5)
    .map(r => `  - ${r.time}: ₺${r.totalSales.toFixed(0)} (${r.orderCount} orders)`)
    .join("\n") || "  (no minute-level data)";

  return `You are a business analyst for DHO, a restaurant in Turkey specializing in waffles, crepes, and desserts.

Analyze the following sales data for ${dateKey} and provide:
1. The most popular food categories or items.
2. Peak sales periods and trends.
3. Underperforming items or gaps.
4. Specific actionable recommendations to improve revenue (promotions, combos, staffing).
5. A one-sentence executive summary.

Keep your response concise, practical, and formatted with clear section headers.

=== DAILY SUMMARY ===
Date: ${dateKey}
Total Revenue: ₺${rev}
Total Orders: ${count}
Cash Sales: ₺${cashSales} | Card Sales: ₺${cardSales}

=== ITEMS SOLD ===
${itemLines}

=== TABLE ACTIVITY ===
${tableLines}

=== PEAK TIMES (top 5 by revenue) ===
${peakMinutes}
`;
}
