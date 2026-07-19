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
// LÓGICA DE DEDUPLICACIÓN INTELIGENTE
// ==========================================
function getTop3Unique(animeList) {
  // 1. Filtrar solo completados con score > 0 y datos válidos
  const validAnime = animeList.filter(entry => entry.score > 0 && entry.media);

  // 2. Objeto para agrupar por "Nombre Base"
  const grouped = {};

  validAnime.forEach(entry => {
    const media = entry.media;
    // Priorizar título en inglés, si no, romaji
    let rawTitle = media.title.english || media.title.romaji || "Desconocido";
    
    // --- ALGORITMO DE LIMPIEZA DE TÍTULOS ---
    let cleanTitle = rawTitle;

    // A. Eliminar sufijos comunes de temporadas y partes
    // Ej: "2nd Season", "Part 2", "Cour 2", "Season 3"
    cleanTitle = cleanTitle.replace(/\s+(?:2nd|3rd|4th|5th|\d+(?:st|nd|rd|th))\s+(?:Season|Part|Cour)/gi, '');
    cleanTitle = cleanTitle.replace(/\s+Season\s+\d+/gi, '');
    cleanTitle = cleanTitle.replace(/\s+Part\s+\d+/gi, '');
    
    // B. Eliminar sufijos de películas y especiales
    // Ej: "Movie", "Special", "OVA"
    cleanTitle = cleanTitle.replace(/\s+(?:Movie|Special|OVA|Recap)$/i, '');

    // C. Eliminar símbolos decorativos al final (muy común en AniList)
    // Ej: "*", "∽", "∬", "~", "†"
    cleanTitle = cleanTitle.replace(/\s*[\*∽~∼∬†]+\s*$/g, '');

    // D. Eliminar años entre paréntesis o corchetes al final
    // Ej: "(2020)", "[2021]"
    cleanTitle = cleanTitle.replace(/\s*[\(\[]\d{4}[\)\]]\s*$/g, '');

    // E. Trim final para limpiar espacios sobrantes
    cleanTitle = cleanTitle.trim();

    // Si la limpieza dejó el título vacío (caso extremo), usamos el original
    if (!cleanTitle) cleanTitle = rawTitle;

    // --- AGRUPACIÓN ---
    // Usamos el 'cleanTitle' como clave única
    if (!grouped[cleanTitle]) {
      grouped[cleanTitle] = {
        displayTitle: rawTitle, // Guardamos el título original para mostrar
        score: entry.score,
        image: media.coverImage.large,
        count: 1
      };
    } else {
      // Si ya existe esta franquicia, comparamos puntuaciones
      // Nos quedamos con la entrada que tenga MAYOR puntuación
      if (entry.score > grouped[cleanTitle].score) {
        grouped[cleanTitle].score = entry.score;
        grouped[cleanTitle].displayTitle = rawTitle; // Actualizamos al título de la versión mejor puntuada
        grouped[cleanTitle].image = media.coverImage.large;
      }
      grouped[cleanTitle].count++;
    }
  });

  // 3. Convertir a array, ordenar descendente por score y tomar los top 3
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
    // 1. Obtener datos de AniList
    console.log('[INFO] Conectando con AniList API...');
    const data = await fetchAniListData();
    
    const listEntries = data.MediaListCollection.lists.flatMap(list => list.entries);
    const stats = data.MediaListCollection.user.statistics.anime;

    console.log(`[INFO] Total animes encontrados en lista: ${listEntries.length}`);

    // 2. Procesar Top 3 Único con Deduplicación
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

    // 3. Construir Payload para Discord
    const dynamicFields = [];

    // A. Campo: Total Anime Watched (Como TEXTO, tipo 1, para coincidir con tu config)
    dynamicFields.push({
      type: 1, 
      name: "anime_watched",
      value: stats.count.toString() 
    });

    // B. Campos: Top 3 Nombres e Imágenes
    for (let i = 0; i < 3; i++) {
      if (top3[i]) {
        // Nombre del anime (Texto)
        dynamicFields.push({
          type: 1, 
          name: `anime_nr${i+1}`,
          value: top3[i].displayTitle
        });
        // Imagen del anime (Image URL)
        dynamicFields.push({
          type: 3, 
          name: `anime_${i+1}`,
          value: { url: top3[i].image }
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
    // console.log(JSON.stringify(payload, null, 2)); // Descomentar para debug detallado

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
