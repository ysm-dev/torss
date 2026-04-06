type MockRoute = {
  body: BodyInit;
  headers?: HeadersInit;
  status?: number;
};

export function createMockFetch(routes: Record<string, Error | MockRoute>) {
  const calls: Request[] = [];

  const fetchImpl = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): ReturnType<typeof fetch> => {
      const request = new Request(input, init);
      calls.push(request);

      const route = routes[request.url];
      if (!route) {
        return new Response("Not found", { status: 404 });
      }

      if (route instanceof Error) {
        throw route;
      }

      return new Response(route.body, {
        headers: route.headers,
        status: route.status ?? 200,
      });
    },
    { preconnect: fetch.preconnect },
  );

  return { calls, fetchImpl };
}
