// Anime → Discord Widget Updater
// Runs in GitHub Actions — one-shot script, no local persistence
//
// Prerequisites (one-time manual setup):
//   1. Get ANILIST_USERNAME (your AniList profile name)
//   2. Add it + DISCORD secrets to GitHub Secrets
//
// This script:
//   1. Fetches your completed anime list from AniList GraphQL API
//   2. Calculates top 3 anime by score
//   3. Builds the Discord widget payload
//   4. PATCHes your Discord application profile widget

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

// ── Delay Helper ───────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetch JSON with Retries ────────────────────────────────────────

async function anilistFetch(query, variables, retries = 3) {
  const url = "https://graphql.anilist.co";
  const data = JSON.stringify({ query, variables });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: data,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AniList API ${res.status}\n${text}`);
      }

      const json = await res.json();
      if (json.errors) {
        throw new Error(`AniList GraphQL Error: ${json.errors[0].message}`);
      }

      return json.data;
    } catch (err) {
      if (attempt === retries) {
        throw err;
      }
      log(`AniList request failed (${attempt}/${retries}), retrying...`);
      await delay(1500);
    }
  }
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

// ── GraphQL Query ─────────────────────────────────────────────────

const query = `
query ($userName: String) {
  MediaListCollection(userName: $userName, type: ANIME, status: COMPLETED) {
    lists {
      entries {
        media {
          title {
            romaji
            english
          }
          coverImage {
            large
          }
          averageScore
        }
        score
      }
    }
    user {
      statistics {
        anime {
          count
        }
      }
    }
  }
}
`;

const variables = { userName: ANILIST_USERNAME };

// ── Get Top 3 Anime by Score ──────────────────────────────────────

function getTop3ByScore(animeList) {
  const validAnime = animeList.filter(
    (entry) => entry.score > 0 && entry.media
  );

  validAnime.sort((a, b) => b.score - a.score);

  return validAnime.slice(0, 3).map((entry) => ({
    title: entry.media.title.english || entry.media.title.romaji || "Unknown",
    score: entry.score,
    image: entry.media.coverImage.large,
  }));
}

// ── MAIN ───────────────────────────────────────────────────────────

async function main() {
  log(`Starting update for AniList user: ${ANILIST_USERNAME}`);

  // 1. Fetch data from AniList
  log("Fetching AniList data...");
  const data = await anilistFetch(query, variables);

  const listEntries = data.MediaListCollection.lists.flatMap(
    (list) => list.entries
  );
  const stats = data.MediaListCollection.user.statistics.anime;

  log(`Found ${listEntries.length} completed anime.`);

  // 2. Calculate top 3 by score
  log("Calculating top 3 anime by score...");
  const top3 = getTop3ByScore(listEntries);

  if (top3.length === 0) {
    log("WARNING: No anime with scores found.");
  } else {
    log("Top 3 anime:");
    top3.forEach((anime, i) => {
      log(`   #${i + 1}: "${anime.title}" (Score: ${anime.score})`);
    });
  }

  // 3. Build widget payload
  log("Building widget payload...");

  const dynamicFields = [
    {
      type: 1,
      name: "anime_watched",
      value: stats.count.toString(),
    },
    {
      type: 1,
      name: "anime_nr1",
      value: top3[0]?.title || "N/A",
    },
    {
      type: 1,
      name: "anime_nr2",
      value: top3[1]?.title || "N/A",
    },
    {
      type: 1,
      name: "anime_nr3",
      value: top3[2]?.title || "N/A",
    },
    {
      type: 3,
      name: "anime_1",
      value: { url: top3[0]?.image || "" },
    },
    {
      type: 3,
      name: "anime_2",
      value: { url: top3[1]?.image || "" },
    },
    {
      type: 3,
      name: "anime_3",
      value: { url: top3[2]?.image || "" },
    },
  ];

  const widget = {
    data: {
      dynamic: dynamicFields,
    },
  };

  log("Widget payload:");
  console.log(JSON.stringify(widget, null, 2));

  // 4. Update Discord widget
  await updateDiscordWidget(widget);

  log("Anime widget update completed successfully.");
}

main()
  .then(() => log("Finished successfully."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
