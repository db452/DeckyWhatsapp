import dotenv from "dotenv";

dotenv.config({ quiet: true });

const rawPort = process.env.PORT ?? "8787";
if (!/^\d{1,5}$/.test(rawPort)) {
  console.error("PORT must be a decimal integer from 1 to 65535.");
  process.exit(2);
}

const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be a decimal integer from 1 to 65535.");
  process.exit(2);
}

process.stdout.write(String(port));
