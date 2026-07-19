// AniList → Discord Widget Updater
// Runs in GitHub Actions — one-shot script, no local persistence
//
// Prerequisites (one-time manual setup):
//   1. Get ANILIST_USERNAME (your AniList username)
//   2. Add it + DISCORD secrets to GitHub Secrets
//
// This script:
//   1. Queries AniList GraphQL API for your anime stats
//   2. Deduplicates seasonal entries (groups by franchise)
//   3. Gets total watched count + top 3 highest scored anime
//   4. Builds the Discord widget payload
//   5. PATCHes your Discord application profile widget

// ── Environment Variables ──────────────────────────────────────────

const {
  ANILIST_USERNAME,
  DISCORD_TOKEN,
  DISCORD_APPLICATION_ID,
  DISCORD_USER_ID,
} = process.env;

// ── Validation ─────────────────────────────────────────────────────

const requiredSecrets = [
  "ANILIST_USERNAME",
  "DISCORD_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_USER_ID",
];

for (const secret of requiredSecrets) {
  if (!process.env[secret]) {
    throw new Error(`Missing secret: ${secret}`);
  }
}

// ── Logging ────────────────────────────────────────────────────────

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// ── AniList GraphQL Query ──────────────────────────────────────────

const ANILIST_QUERY = `
query($userName: String) {
  User(name: $userName) {
    statistics {
      anime {
        count
        episodesWatched
        minutesWatched
        meanScore
      }
    }
  }
  MediaListCollection(userName: $userName, type: ANIME, status: COMPLETED, sort: SCORE_DESC) {
    lists {
      entries {
        score
        media {
          id
          title {
            romaji
            english
          }
          coverImage {
            large
          }
          format
        }
      }
    }
  }
}
`;

async function fetchAniListData(username) {
  log("Fetching AniList data...");

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: ANILIST_QUERY,
      variables: { userName: username },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AniList API failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.errors) {
    throw new Error(`AniList GraphQL error: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

// ── Deduplication Logic ────────────────────────────────────────────

/**
 * Groups anime entries by franchise to avoid duplicates like:
 * "OSHI NO KO", "OSHI NO KO Season 2", "OSHI NO KO Movie"
 * 
 * Returns the highest scored entry from each franchise
 */
function deduplicateByFranchise(entries) {
  const franchiseMap = new Map();

  // Regex patterns to detect season/sequel indicators
  const seasonPatterns = [
    /\s+Season\s+\d+/i,
    /\s+\d+(st|nd|rd|th)\s+Season/i,
    /\s+Part\s+\d+/i,
    /\s+Cour\s+\d+/i,
    /\s+Movie$/i,
    /\s+Film$/i,
    /\s+Special$/i,
    /\s+OVA$/i,
  ];

  for (const entry of entries) {
    const title = entry.media.title.romaji || entry.media.title.english || "";
    const score = entry.score || 0;

    // Normalize title by removing season indicators
    let normalizedTitle = title;
    for (const pattern of seasonPatterns) {
      normalizedTitle = normalizedTitle.replace(pattern, "");
    }
    normalizedTitle = normalizedTitle.trim();

    // Keep the highest scored entry for each franchise
    if (!franchiseMap.has(normalizedTitle)) {
      franchiseMap.set(normalizedTitle, { ...entry, normalizedTitle });
    } else {
      const existing = franchiseMap.get(normalizedTitle);
      if (score > existing.score) {
        franchiseMap.set(normalizedTitle, { ...entry, normalizedTitle });
      }
    }
  }

  return Array.from(franchiseMap.values());
}

// ── Discord widget update ──────────────────────────────────────────

async function updateDiscordWidget(payload) {
  log("Updating Discord widget...");

  const res = await fetch(
    `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/users/${DISCORD_USER_ID}/identities/0/profile`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent":
          "DiscordBot (https://github.com/discord/discord-api-docs, 1.0.0)",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }

  log("Discord widget updated.");
}

// ── MAIN ───────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch data from AniList
  const data = await fetchAniListData(ANILIST_USERNAME);

  // 2. Extract stats
  log("Calculating statistics...");

  const animeStats = data.User.statistics.anime;
  const totalCount = animeStats.count ?? 0;

  // Get completed anime list and deduplicate
  const completedEntries = data.MediaListCollection.lists?.[0]?.entries ?? [];
  const deduplicated = deduplicateByFranchise(completedEntries);

  // Get top 3 highest scored anime
  const top3 = deduplicated.slice(0, 3);

  const animeNr1 = top3[0]?.media?.title?.romaji || top3[0]?.media?.title?.english || "None";
  const animeNr2 = top3[1]?.media?.title?.romaji || top3[1]?.media?.title?.english || "None";
  const animeNr3 = top3[2]?.media?.title?.romaji || top3[2]?.media?.title?.english || "None";

  // 3. Console summary
  log("─────────────────────────────");
  log(`Username: ${ANILIST_USERNAME}`);
  log(`Total Anime Watched: ${totalCount}`);
  log(`Top #1: ${animeNr1}${top3[0]?.score ? ` (Score: ${top3[0].score})` : ""}`);
  log(`Top #2: ${animeNr2}${top3[1]?.score ? ` (Score: ${top3[1].score})` : ""}`);
  log(`Top #3: ${animeNr3}${top3[2]?.score ? ` (Score: ${top3[2].score})` : ""}`);
  log("─────────────────────────────");

  // 4. Build widget payload
  log("Building widget payload...");

  const widget = {
    username: ANILIST_USERNAME,
    data: {
      dynamic: [
        { type: 1, name: "anime_watched", value: String(totalCount) },
        { type: 1, name: "anime_nr1", value: animeNr1 },
        { type: 1, name: "anime_nr2", value: animeNr2 },
        { type: 1, name: "anime_nr3", value: animeNr3 },
        { type: 3, name: "anime_1", value: { url: top3[0]?.media?.coverImage?.large || "" } },
        { type: 3, name: "anime_2", value: { url: top3[1]?.media?.coverImage?.large || "" } },
        { type: 3, name: "anime_3", value: { url: top3[2]?.media?.coverImage?.large || "" } },
      ],
    },
  };

  log("Widget payload:");
  console.log(JSON.stringify(widget, null, 2));

  // 5. Push to Discord
  await updateDiscordWidget(widget);

  log("Anime widget update completed successfully.");
}

main()
  .then(() => log("Finished successfully."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
