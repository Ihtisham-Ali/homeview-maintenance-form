// Serverless Function for fetching and caching property items from Monday.com Board
// Board Name: " Properties :" | Board ID: 5099688677

export const config = { runtime: "edge" };

// Check all common environment variable naming variations in Vercel
const MONDAY_API_KEY =
  process.env.MONDAY_API_KEY ||
  process.env.MONDAY_API_TOKEN ||
  process.env.MONDAY_TOKEN ||
  process.env.MONDAY_KEY ||
  "";

const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID || "5099688677";

export default async function handler(req, res) {
  const isNode = typeof res !== "undefined" && typeof res.status === "function";

  const getHeader = (name) => {
    if (!req || !req.headers) return "";
    if (typeof req.headers.get === "function") return req.headers.get(name) || "";
    return req.headers[name.toLowerCase()] || req.headers[name] || "";
  };

  const method = req.method || "GET";

  if (method === "OPTIONS") {
    if (isNode) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-monday-api-key");
      return res.status(204).end();
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-monday-api-key"
      }
    });
  }

  if (method !== "GET") {
    const errorBody = { ok: false, error: "Method not allowed" };
    if (isNode) return res.status(405).json(errorBody);
    return new Response(JSON.stringify(errorBody), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const apiKey = (MONDAY_API_KEY || getHeader("x-monday-api-key") || "").trim();

  if (!apiKey || apiKey === "PASTE_YOUR_MONDAY_API_KEY_HERE") {
    const notConfigured = {
      ok: false,
      configured: false,
      error: "Monday.com API key is not configured.",
      hint: "Set MONDAY_API_KEY in Vercel Project Settings > Environment Variables",
      boardId: MONDAY_BOARD_ID,
      boardName: " Properties :",
      properties: []
    };
    if (isNode) return res.status(200).json(notConfigured);
    return new Response(JSON.stringify(notConfigured), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const allItems = [];
    let cursor = null;
    let pageCount = 0;
    const maxPages = 20; // Up to 10,000 items

    do {
      pageCount++;
      const query = cursor
        ? `query {
            next_items_page(cursor: ${JSON.stringify(cursor)}, limit: 500) {
              cursor
              items {
                id
                name
              }
            }
          }`
        : `query {
            boards(ids: [${MONDAY_BOARD_ID}]) {
              id
              name
              items_page(limit: 500) {
                cursor
                items {
                  id
                  name
                }
              }
            }
          }`;

      const mondayRes = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": apiKey,
          "API-Version": "2024-10"
        },
        body: JSON.stringify({ query })
      });

      if (!mondayRes.ok) {
        const errorText = await mondayRes.text();
        console.error("[Monday.com API HTTP Error]", mondayRes.status, errorText);
        throw new Error(`Monday API HTTP ${mondayRes.status}`);
      }

      const mondayData = await mondayRes.json();

      if (mondayData.errors && mondayData.errors.length > 0) {
        // Fallback for older Monday API syntax if items_page fails
        if (pageCount === 1) {
          const fallbackRes = await fetch("https://api.monday.com/v2", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": apiKey
            },
            body: JSON.stringify({
              query: `query { boards(ids: [${MONDAY_BOARD_ID}]) { id name items(limit: 500) { id name } } }`
            })
          });
          const fallbackData = await fallbackRes.json();
          const fallbackItems = fallbackData?.data?.boards?.[0]?.items || [];
          const list = fallbackItems
            .map((it) => ({ id: String(it.id), name: String(it.name || "").trim() }))
            .filter((it) => it.name.length > 0);

          list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

          const result = {
            ok: true,
            configured: true,
            boardId: MONDAY_BOARD_ID,
            boardName: fallbackData?.data?.boards?.[0]?.name || " Properties :",
            total: list.length,
            properties: list
          };

          if (isNode) {
            res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.status(200).json(result);
          }

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400"
            }
          });
        }
        throw new Error(mondayData.errors[0]?.message || "GraphQL error from Monday.com");
      }

      let pageItems = [];
      if (cursor) {
        pageItems = mondayData?.data?.next_items_page?.items || [];
        cursor = mondayData?.data?.next_items_page?.cursor || null;
      } else {
        const board = mondayData?.data?.boards?.[0];
        pageItems = board?.items_page?.items || [];
        cursor = board?.items_page?.cursor || null;
      }

      for (const item of pageItems) {
        const cleanName = String(item.name || "").trim();
        if (cleanName) {
          allItems.push({
            id: String(item.id),
            name: cleanName
          });
        }
      }

      if (!cursor || pageItems.length === 0 || pageCount >= maxPages) {
        break;
      }
    } while (cursor);

    // Natural alphabetical sort (e.g. Flat 1, Flat 2, Flat 10)
    allItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    const successData = {
      ok: true,
      configured: true,
      boardId: MONDAY_BOARD_ID,
      boardName: " Properties :",
      total: allItems.length,
      properties: allItems
    };

    if (isNode) {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(successData);
    }

    return new Response(JSON.stringify(successData), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400"
      }
    });
  } catch (err) {
    console.error("[Monday Properties Relay Exception]", err);
    const errData = {
      ok: false,
      error: err.message || "Failed to fetch properties from Monday.com",
      properties: []
    };
    if (isNode) return res.status(500).json(errData);
    return new Response(JSON.stringify(errData), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
