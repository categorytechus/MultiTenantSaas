import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date') || '';
  
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Assistant//Calendar Event//EN',
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${dateStr.replace(/-/g, '')}`,
    `SUMMARY:Event from AI Assistant`,
    `DESCRIPTION:Event mentioned in AI Assistant chat`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return new NextResponse(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${dateStr}.ics"`,
    },
  });
}
