/**
 * Build external booking links from booking details.
 *
 * Hotel: Booking.com deep-link to prefilled search results:
 *   - destination ("ss"), checkin/checkout, guests, rooms
 *
 * Taxi: WhatsApp deep-link with prefilled message to a Mauritius taxi number.
 * (This is the most reliable "prefilled form" approach without scraping or a paid API.)
 */

export function buildHotelLinkBookingCom({
  hotelNameOrArea,
  checkIn,
  checkOut,
  adults,
  children,
  rooms
}) {
  const base = "https://www.booking.com/searchresults.en-gb.html";
  const params = new URLSearchParams();

  // Force Mauritius context so searches are relevant even if user says only a town/beach
  const destination = `Mauritius ${hotelNameOrArea || ""}`.trim();

  params.set("ss", destination);
  params.set("checkin", checkIn);     // YYYY-MM-DD
  params.set("checkout", checkOut);   // YYYY-MM-DD
  params.set("group_adults", String(Math.max(1, Number(adults) || 1)));
  params.set("group_children", String(Math.max(0, Number(children) || 0)));
  params.set("no_rooms", String(Math.max(1, Number(rooms) || 1)));

  return `${base}?${params.toString()}`;
}

export function buildTaxiLinkWhatsApp({
  pickupLocation,
  dropoffLocation,
  pickupDate,
  pickupTime,
  passengers,
  luggage,
  notes
}) {
  // Replace with the WhatsApp/phone number of your chosen taxi provider (country code + number, no + sign)
  // Example: Mauritius country code 230
  const phone = "23059550305";

  const lines = [
    "Taxi Booking Request (via Travel Buddy):",
    `Pickup: ${pickupLocation || "-"}`,
    `Dropoff: ${dropoffLocation || "-"}`,
    `Date: ${pickupDate || "-"}`,
    `Time: ${pickupTime || "-"}`,
    `Passengers: ${passengers || "-"}`,
    `Luggage: ${luggage || "-"}`,
    notes ? `Notes: ${notes}` : null
  ].filter(Boolean);

  const text = lines.join("\n");

  const base = `https://wa.me/${phone}`;
  const params = new URLSearchParams();
  params.set("text", text);

  return `${base}?${params.toString()}`;
}