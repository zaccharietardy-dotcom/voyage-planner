const fs = require("fs");
const content = fs.readFileSync(".env.local", "utf-8");
for (const line of content.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const eqIdx = line.indexOf("=");
  if (eqIdx === -1) continue;
  const key = line.substring(0, eqIdx).trim();
  let value = line.substring(eqIdx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = value;
}
console.log("ANTHROPIC:", process.env.ANTHROPIC_API_KEY?.substring(0, 15));
console.log("SERPAPI:", process.env.SERPAPI_KEY?.substring(0, 10));
console.log("RAPIDAPI:", process.env.RAPIDAPI_KEY?.substring(0, 10));
