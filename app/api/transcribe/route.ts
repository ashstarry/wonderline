// Uploaded recordings use the same bounded realtime gateway as the microphone.
export async function POST() { return Response.json({ error: 'Please upload audio through the studio streaming control.' }, { status: 410 }); }
