const https = require('https');

// ==========================================
// CONFIGURACIÓN (Desde Variables de Entorno)
// ==========================================
const ANILIST_USERNAME = process.env.ANILIST_USERNAME;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID; // Debe ser el SERVER ID

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
// LÓGICA SIMPLE: ORDENAR Y TOMAR TOP 3
// ==========================================
function getTop3Simple(animeList) {
  // 1. Filtrar solo completados con score > 0
  const validAnime = animeList.filter(entry => entry.score > 0 && entry.media);

  // 2. Ordenar directamente por puntuación (Mayor a Menor)
  // SIN deduplicación, SIN agrupación, SIN limpieza de títulos.
  validAnime.sort((a, b) => b.score - a.score);

  // 3. Tomar los primeros 3
  return validAnime.slice(0, 3);
}

// ==========================================
// FUNCIÓN PRINCIPAL
// ==========================================
async function main() {
  console.log(`[INFO] Iniciando actualización para usuario: ${ANILIST_USERNAME}`);

  try {
    // 1. Obtener datos de AniList
    console.log('[INFO] Conectando con AniList API...');
    const data = await fetchAniListData();
    
    const listEntries = data.MediaListCollection.lists.flatMap(list => list.entries);
    const stats = data.MediaListCollection.user.statistics.anime;

    console.log(`[INFO] Total animes encontrados: ${listEntries.length}`);

    // 2. Procesar Top 3 (Sin filtros raros)
    console.log('[INFO] Obteniendo Top 3 por puntuación...');
    const top3 = getTop3Simple(listEntries);

    if (top3.length === 0) {
      console.warn('[WARN] No se encontraron animes con puntuación.');
    } else {
      console.log('[INFO] Top 3 seleccionado:');
      top3.forEach((entry, i) => {
        const title = entry.media.title.english || entry.media.title.romaji;
        console.log(`   #${i+1}: "${title}" (Score: ${entry.score})`);
      });
    }

    // 3. Construir Payload para Discord
    const dynamicFields = [];

    // A. Campo: Total Anime Watched (Como TEXTO, tipo 1)
    dynamicFields.push({
      type: 1, 
      name: "anime_watched",
      value: stats.count.toString() 
    });

    // B. Campos: Top 3 Nombres e Imágenes
    for (let i = 0; i < 3; i++) {
      if (top3[i]) {
        const entry = top3[i];
        const title = entry.media.title.english || entry.media.title.romaji || "Desconocido";
        
        // Nombre del anime (Texto)
        dynamicFields.push({
          type: 1, 
          name: `anime_nr${i+1}`,
          value: title
        });
        // Imagen del anime (Image URL)
        dynamicFields.push({
          type: 3, 
          name: `anime_${i+1}`,
          value: { url: entry.media.coverImage.large }
        });
      } else {
        // Rellenar con valores por defecto si no hay 3 animes
        dynamicFields.push({ type: 1, name: `anime_nr${i+1}`, value: "N/A" });
        dynamicFields.push({ type: 3, name: `anime_${i+1}`, value: { url: "https://via.placeholder.com/150?text=Empty" } });
      }
    }

    const payload = {
      data: {
        dynamic: dynamicFields
      }
    };

    console.log('[INFO] Payload generado correctamente.');

    // 4. Enviar a Discord API
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
