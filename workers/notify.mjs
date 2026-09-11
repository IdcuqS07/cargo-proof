export async function notifyOwner({ title, content }) {
  const baseUrl = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!baseUrl || !apiKey) {
    console.warn("[Notification] Built-in notification credentials are not configured");
    return false;
  }
  const response = await fetch(`${baseUrl}/webdevtoken.v1.WebDevService/SendNotification`, {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, "content-type": "application/json", "connect-protocol-version": "1" },
    body: JSON.stringify({ title, content }),
  });
  if (!response.ok) {
    console.warn(`[Notification] Owner notification failed: ${response.status}`);
    return false;
  }
  return true;
}
