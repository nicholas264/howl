import { requirePermission } from "./_lib/app-access.js";
import { fetchDealerOrders } from "./_lib/dealer-analytics.js";

export function createDealerAnalyticsHandler({
  authorize = requirePermission,
  load = fetchDealerOrders,
  now = Date.now,
} = {}) {
  let cached = null,
    cachedAt = 0,
    pending = null;
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (!["GET", "POST"].includes(req.method))
      return res.status(405).json({ error: "Method not allowed" });
    if (!(await authorize(req, res, "analytics.read"))) return;
    try {
      if (req.method === "GET" && cached && now() - cachedAt < 300000)
        return res.json(cached);
      if (!pending)
        pending = load()
          .then((data) => {
            cached = data;
            cachedAt = now();
            return data;
          })
          .finally(() => {
            pending = null;
          });
      return res.json(await pending);
    } catch (error) {
      return res
        .status(502)
        .json({
          error:
            error.name === "TimeoutError"
              ? "Shopify took too long to respond. Retry the sync."
              : error.message,
        });
    }
  };
}
export default createDealerAnalyticsHandler();
