const BACKEND_API_BASE_URL =
  process.env.CALENDAR_API_BASE_URL ??
  process.env.CATALOG_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://backend:8080";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = await fetch(
    `${BACKEND_API_BASE_URL}/api/calendar/events${url.search}`,
    {
      cache: "no-store",
    },
  );

  return toProxyResponse(response);
}

export async function POST(request: Request) {
  const response = await fetch(`${BACKEND_API_BASE_URL}/api/calendar/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: await request.text(),
  });

  return toProxyResponse(response);
}

function toProxyResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
