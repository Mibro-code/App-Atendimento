import db from "../db.server";

export async function loader() {
  try {
    await db.$queryRaw`SELECT 1`;

    return Response.json(
      {status: "ok"},
      {headers: {"Cache-Control": "no-store"}},
    );
  } catch (error) {
    console.error("Health check failed", error);

    return Response.json(
      {status: "unavailable"},
      {
        status: 503,
        headers: {"Cache-Control": "no-store"},
      },
    );
  }
}
