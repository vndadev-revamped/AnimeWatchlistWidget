const https = require('https');

// ==========================================
// CONFIGURACIÓN (Desde Variables de Entorno)
// ==========================================
const ANILIST_USERNAME = process.env.ANILIST_USERNAME;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID; // DEBE SER EL SERVER ID (GUILD ID)

if (!ANILIST_USERNAME || !DISCORD_TOKEN || !DISCORD_APPLICATION_ID || !DISCORD_USER_ID) {
  console.error('[ERROR] Faltan variables de entorno necesarias.');
  process.exit(1);
}

// ==========================================
// QUERY GRAPHQL A ANILIST
// ==========================================
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
          genres
          averageScore
          seasonYear
        }
        score
      }
    }
    user {
      statistics {
        anime {
          count
          episodesWatched
          minutesWatched
          meanScore
        }
      }
    }
  }
}
`;

const variables = { userName: ANILIST_USERNAME };

// ==========================================
// FUNCIÓN: PETICIÓN HTTPS A ANILIST
// ==========================================
function fetchAniListData() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const options = {
      hostname: 'graphql.anilist.co',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (json.errors) throw new Error(json.errors[0].message);
          resolve(json.data);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

// ==========================================
// LÓGICA DE DEDUPLICACIÓN INTELIGENTE (V2)
// ==========================================
function getTop3Unique(animeList) {
  const validAnime = animeList.filter(entry => entry.score > 0 && entry.media);
  const grouped = {};

  validAnime.forEach(entry => {
    const media = entry.media;
    let rawTitle = media.title.english || media.title.romaji || "Desconocido";
    
    let cleanTitle = rawTitle;

    // 1. Eliminar sufijos de temporadas explícitas (Season 2, Part 2, etc.)
    cleanTitle = cleanTitle.replace(/\s+(?:2nd|3rd|4th|5th|\d+(?:st|nd|rd|th))\s+(?:Season|Part|Cour)/gi, '');
    cleanTitle = cleanTitle.replace(/\s+Season\s+\d+/gi, '');
    cleanTitle = cleanTitle.replace(/\s+Part\s+\d+/gi, '');
    
    // 2. Eliminar películas y especiales
    cleanTitle = cleanTitle.replace(/\s+(?:Movie|Special|OVA|Recap)$/i, '');

    // 3. Eliminar símbolos decorativos al final
    cleanTitle = cleanTitle.replace(/\s*[\*∽~∼∬†]+\s*$/g, '');

    // 4. Eliminar años
    cleanTitle = cleanTitle.replace(/\s*[\(\[]\d{4}[\)\]]\s*$/g, '');

    // 5. NUEVO: Eliminar números simples al final (ej: "Quintuplets 2" -> "Quintuplets")
    // Esto ayuda si la API devuelve "Title 2" en lugar de "Title Season 2"
    cleanTitle = cleanTitle.replace(/\s+\d+$/g, '');

    cleanTitle = cleanTitle.trim();

    if (!cleanTitle) cleanTitle = rawTitle;

    if (!grouped[cleanTitle]) {
      grouped[cleanTitle] = {
        displayTitle: rawTitle,
        score: entry.score,
        image: media.coverImage.large,
        count: 1
      };
    } else {
      if (entry.score > grouped[cleanTitle].score) {
        grouped[cleanTitle].score = entry.score;
        grouped[cleanTitle].displayTitle = rawTitle;
        grouped[cleanTitle].image = media.coverImage.large;
      }
      grouped[cleanTitle].count++;
    }
  });

  const uniqueList = Object.values(grouped)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return uniqueList;
}

// ==========================================
// FUNCIÓN PRINCIPAL
// ==========================================
async function main() {
  console.log(`[INFO] Iniciando actualización para usuario: ${ANILIST_USERNAME}`);

  try {
    console.log('[INFO] Conectando con AniList API...');
    const data = await fetchAniListData();
    
    const listEntries = data.MediaListCollection.lists.flatMap(list => list.entries);
    const stats = data.MediaListCollection.user.statistics.anime;

    console.log(`[INFO] Total animes encontrados en lista: ${listEntries.length}`);

    console.log('[INFO] Calculando Top 3 único (agrupando franquicias)...');
    const top3 = getTop3Unique(listEntries);

    if (top3.length === 0) {
      console.warn('[WARN] No se encontraron animes con puntuación para mostrar.');
    } else {
      console.log('[INFO] Resultado tras deduplicación:');
      top3.forEach((anime, i) => {
        console.log(`   #${i+1}: "${anime.displayTitle}" (Score: ${anime.score}) [Agrupado: ${anime.count} entradas]`);
      });
    }

    const dynamicFields = [];

    // Campo: Total Anime Watched (Texto)
    dynamicFields.push({
      type: 1, 
      name: "anime_watched",
      value: stats.count.toString() 
    });

    // Campos: Top 3 Nombres e Imágenes
    for (let i = 0; i < 3; i++) {
      if (top3[i]) {
        dynamicFields.push({
          type: 1, 
          name: `anime_nr${i+1}`,
          value: top3[i].displayTitle
        });
        dynamicFields.push({
          type: 3, 
          name: `anime_${i+1}`,
          value: { url: top3[i].image }
        });
      } else {
        dynamicFields.push({ type: 1, name: `anime_nr${i+1}`, value: "N/A" });
        dynamicFields.push({ type: 3, name: `anime_${i+1}`, value: { url: "https://via.placeholder.com/150?text=Empty" } });
      }
    }

    const payload = {
       {
        dynamic: dynamicFields
      }
    };

    console.log('[INFO] Payload generado correctamente.');
    console.log('[INFO] Enviando actualización a Discord...');
    
    const discordData = JSON.stringify(payload);
    const discordOptions = {
      hostname: 'discord.com',
      path: `/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_USER_ID}/widget`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': discordData.length
      }
    };

    await new Promise((resolve, reject) => {
      const req = https.request(discordOptions, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[SUCCESS] ✅ Widget de Discord actualizado correctamente.');
            resolve();
          } else {
            console.error(`[ERROR] ❌ Discord API respondió con ${res.statusCode}: ${responseData}`);
            console.error('[HINT] Verifica que DISCORD_USER_ID sea el ID del SERVIDOR (no tu ID de usuario).');
            console.error('[HINT] Verifica que la App esté invitada al servidor con permisos de "Manage Server".');
            reject(new Error(`Discord API Error: ${res.statusCode}`));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.write(discordData);
      req.end();
    });

    console.log('[INFO] 🎉 Proceso finalizado con éxito.');

  } catch (error) {
    console.error('[FATAL] 💥 Error crítico:', error.message);
    process.exit(1);
  }
}

main();
