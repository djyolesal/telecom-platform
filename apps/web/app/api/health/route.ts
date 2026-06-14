import { NextResponse } from 'next/server';

/** Endpoint de santé interrogé par le healthcheck Docker (cf. Dockerfile). */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'web', timestamp: new Date().toISOString() });
}
