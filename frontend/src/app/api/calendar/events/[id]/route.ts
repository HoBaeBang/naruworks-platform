const BACKEND_API_BASE_URL =
  process.env.CALENDAR_API_BASE_URL ??
  process.env.CATALOG_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://backend:8080";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const response = await fetch(
    `${BACKEND_API_BASE_URL}/api/calendar/events/${id}`,
    {
      cache: "no-store",
    },
  );

  return toProxyResponse(response);
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const response = await fetch(
    `${BACKEND_API_BASE_URL}/api/calendar/events/${id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: await request.text(),
    },
  );

  return toProxyResponse(response);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const response = await fetch(
    `${BACKEND_API_BASE_URL}/api/calendar/events/${id}`,
    {
      method: "DELETE",
    },
  );

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
