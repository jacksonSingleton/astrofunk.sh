import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async () => {
  const apiKey = import.meta.env.HARDCOVER_API_KEY;

  const query = `
    {
      list_books(where: {list_id: {_eq: 237858}}) {
        book {
          id
          title
          image {
            url
          }
          slug
        }
      }
    }
    `;

  try {
    const res = await fetch("https://api.hardcover.app/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      throw new Error(`Error fetching data: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Hardcover error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch books from Hardcover" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
