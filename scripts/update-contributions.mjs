import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const login = process.env.GITHUB_LOGIN || "pedroRez";
const year = Number(process.env.CONTRIBUTIONS_YEAR || new Date().getUTCFullYear());
const outputPath = resolve(process.env.CONTRIBUTIONS_OUTPUT || "assets/contributions.svg");
const token = process.env.PROFILE_STATS_TOKEN || process.env.CONTRIBUTIONS_TOKEN || process.env.GH_TOKEN || "";
const manualTotal = process.env.CONTRIBUTIONS_TOTAL;
const allowPublicFallback = process.env.ALLOW_PUBLIC_FALLBACK === "true";

function formatPtBr(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchGraphqlTotal() {
  const from = `${year}-01-01T00:00:00Z`;
  const to = new Date().toISOString();
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
          }
          restrictedContributionsCount
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "pedroRez-profile-contributions",
    },
    body: JSON.stringify({ query, variables: { login, from, to } }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(`GitHub GraphQL error: ${message}`);
  }

  const collection = payload.data?.user?.contributionsCollection;
  if (!collection) {
    throw new Error(`GitHub user not found: ${login}`);
  }

  return {
    total: collection.contributionCalendar.totalContributions,
    restricted: collection.restrictedContributionsCount || 0,
    source: "GitHub GraphQL autenticado",
  };
}

async function fetchPublicTotal() {
  const url = `https://github.com/users/${login}/contributions?from=${year}-01-01&to=${year}-12-31`;
  const response = await fetch(url, {
    headers: { "user-agent": "pedroRez-profile-contributions" },
  });

  if (!response.ok) {
    throw new Error(`GitHub public contributions error: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/([\d,.]+)\s+contributions\s+in\s+\d{4}/i);
  if (!match) {
    throw new Error("Could not parse public contribution total");
  }

  return {
    total: Number(match[1].replace(/[,.]/g, "")),
    restricted: 0,
    source: "calendário público do GitHub",
  };
}

function buildSvg({ total, restricted, source }) {
  const totalLabel = formatPtBr(total);
  const restrictedLabel = restricted ? `${formatPtBr(restricted)} privadas/restritas` : "privadas anonimizadas";
  const sourceLabel = escapeXml(source);

  return `<svg width="900" height="180" viewBox="0 0 900 180" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${totalLabel} contribuições em ${year}</title>
  <desc id="desc">Total anual de contribuições do GitHub para ${login}, atualizado automaticamente.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="900" y2="180" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0f172a"/>
      <stop offset="0.52" stop-color="#172554"/>
      <stop offset="1" stop-color="#0e7490"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(735 24) rotate(129.806) scale(178 230)">
      <stop stop-color="#38bdf8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="900" height="180" rx="22" fill="url(#bg)"/>
  <rect width="900" height="180" rx="22" fill="url(#glow)"/>
  <rect x="24" y="24" width="852" height="132" rx="18" fill="white" fill-opacity="0.08" stroke="white" stroke-opacity="0.16"/>
  <circle cx="56" cy="54" r="7" fill="#fb7185"/>
  <circle cx="79" cy="54" r="7" fill="#fbbf24"/>
  <circle cx="102" cy="54" r="7" fill="#34d399"/>
  <text x="48" y="102" fill="#e0f2fe" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="2">CONTRIBUIÇÕES EM ${year}</text>
  <text x="48" y="143" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="600">inclui ${escapeXml(restrictedLabel)} sem expor repositórios privados</text>
  <text x="840" y="106" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="58" font-weight="800" text-anchor="end">${totalLabel}</text>
  <text x="840" y="137" fill="#bae6fd" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600" text-anchor="end">${sourceLabel}</text>
</svg>
`;
}

async function main() {
  let stats;

  if (manualTotal) {
    stats = {
      total: Number(manualTotal),
      restricted: 0,
      source: "valor inicial informado",
    };
  } else if (token) {
    stats = await fetchGraphqlTotal();
  } else if (allowPublicFallback) {
    stats = await fetchPublicTotal();
  } else {
    try {
      await readFile(outputPath, "utf8");
      console.log("PROFILE_STATS_TOKEN not set; keeping existing contributions SVG.");
      return;
    } catch {
      throw new Error("PROFILE_STATS_TOKEN is required to generate private-aware contribution stats.");
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildSvg(stats), "utf8");
  console.log(`Updated ${outputPath} with ${stats.total} contributions for ${year}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
