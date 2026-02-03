import fs from "fs";
import path from "path";
import QRCode from "qrcode";

/**
 * Generates a PNG QR code file for a given URL.
 * Returns absolute file path.
 */
export async function generateBookingQrPng({ bookingId, url }) {
  const dir = path.join(process.cwd(), "uploads", "qr");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `booking-${bookingId}.png`);

  // Creates a PNG QR code file
  await QRCode.toFile(filePath, url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320
  });

  return filePath;
}