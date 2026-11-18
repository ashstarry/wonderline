export async function POST() { return Response.json({ error: 'Local hosting is permanently disabled.' }, { status: 410 }); }
