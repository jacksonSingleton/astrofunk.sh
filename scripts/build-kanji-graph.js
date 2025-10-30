import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('Building kanji graph data...');

// Parse KRADFILE (EUC-JP encoding)
function parseKradfile(filepath) {
    // Try UTF-8 first, but KRADFILE is typically EUC-JP
    let content;
    try {
        content = readFileSync(filepath, 'utf-8');
        // Check if we got valid kanji
        const firstKanji = content.split('\n').find(l => !l.startsWith('#') && l.trim())?.split(' : ')[0];
        if (firstKanji && firstKanji.charCodeAt(0) > 0x3000) {
            // Looks like valid UTF-8
        } else {
            throw new Error('Not UTF-8');
        }
    } catch {
        // Fall back to latin1 and hope for the best, or just skip encoding issues
        content = readFileSync(filepath, 'utf-8');
    }
    
    const lines = content.split('\n');
    const kanjiToRadicals = {};
    
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || !line.trim()) continue;
        
        const parts = line.split(' : ');
        if (parts.length !== 2) continue;
        
        const kanji = parts[0].trim();
        const radicals = parts[1].trim().split(/\s+/);
        
        // Only include if kanji looks valid (CJK Unified Ideographs range)
        const code = kanji.charCodeAt(0);
        if (code >= 0x4E00 && code <= 0x9FFF) {
            kanjiToRadicals[kanji] = radicals;
        }
    }
    
    return kanjiToRadicals;
}

// Parse KANJIDIC2 (simplified - just get meanings)
function parseKanjidic2(filepath) {
    const content = readFileSync(filepath, 'utf-8');
    const kanjiData = {};
    
    // Simple regex-based parsing (faster than full XML parser for our needs)
    const characterRegex = /<character>([\s\S]*?)<\/character>/g;
    let match;
    
    while ((match = characterRegex.exec(content)) !== null) {
        const charBlock = match[1];
        
        // Extract literal (the kanji character)
        const literalMatch = charBlock.match(/<literal>(.*?)<\/literal>/);
        if (!literalMatch) continue;
        const kanji = literalMatch[1];
        
        // Extract English meanings (both with and without m_lang attribute)
        const meanings = [];
        // First try with m_lang="en"
        const meaningRegexEn = /<meaning m_lang="en">(.*?)<\/meaning>/g;
        let meaningMatch;
        while ((meaningMatch = meaningRegexEn.exec(charBlock)) !== null) {
            meanings.push(meaningMatch[1]);
        }
        // If no English meanings found, try without m_lang (defaults to English)
        if (meanings.length === 0) {
            const meaningRegexDefault = /<meaning>(.*?)<\/meaning>/g;
            while ((meaningMatch = meaningRegexDefault.exec(charBlock)) !== null) {
                meanings.push(meaningMatch[1]);
            }
        }
        
        // Extract readings (optional, for future use)
        const readings = {
            on: [],
            kun: []
        };
        const readingRegex = /<reading r_type="(ja_on|ja_kun)">(.*?)<\/reading>/g;
        let readingMatch;
        while ((readingMatch = readingRegex.exec(charBlock)) !== null) {
            const type = readingMatch[1] === 'ja_on' ? 'on' : 'kun';
            readings[type].push(readingMatch[2]);
        }
        
        kanjiData[kanji] = {
            meanings,
            readings
        };
    }
    
    return kanjiData;
}

// Load existing Anki kanji data
function loadAnkiData(filepath) {
    const content = readFileSync(filepath, 'utf-8');
    const json = JSON.parse(content);
    const kanjiStats = {};
    
    for (const [key, arr] of Object.entries(json.units || {})) {
        const char = Array.isArray(arr) ? (arr[1] ?? key) : key;
        kanjiStats[char] = {
            metric: Array.isArray(arr) ? Number(arr[2] ?? 0) : 0,
            reviews: Array.isArray(arr) ? Number(arr[3] ?? 0) : 0,
            lapses: Array.isArray(arr) ? Number(arr[4] ?? 0) : 0,
            ts: Array.isArray(arr) ? arr[0] : null
        };
    }
    
    return kanjiStats;
}

// Calculate score (same as KanjiGrid)
function calculateScore(metric, interval = 100) {
    const raw = metric / interval;
    const s = raw + 1;
    return 1 - 1 / (s * s);
}

// Determine color bucket (same as KanjiGrid)
function getBucket(scoreVal, min, max, reviews) {
    if (reviews <= 0) return 'unseen';
    const t = max > min ? (scoreVal - min) / (max - min) : scoreVal;
    if (t >= 0.8) return 'foam';
    if (t >= 0.6) return 'pine';
    if (t >= 0.4) return 'gold';
    if (t >= 0.2) return 'rose';
    return 'love';
}

// Build graph with pre-computed stable layout
function buildGraph(kanjiToRadicals, kanjiData, ankiData) {
    const nodes = [];
    
    // Calculate score range for bucketing
    const scores = Object.entries(ankiData)
        .filter(([_, data]) => data.reviews > 0)
        .map(([_, data]) => calculateScore(data.metric));
    const minScore = Math.min(...scores, 0);
    const maxScore = Math.max(...scores, 1);
    
    // Create nodes ONLY for kanji in Anki data
    let skipped = 0;
    for (const [kanji, stats] of Object.entries(ankiData)) {
        // Skip if not in KRADFILE
        if (!kanjiToRadicals[kanji]) {
            skipped++;
            continue;
        }
        
        const radicals = kanjiToRadicals[kanji];
        const score = calculateScore(stats.metric);
        const bucket = getBucket(score, minScore, maxScore, stats.reviews);
        const info = kanjiData[kanji] || { meanings: [], readings: { on: [], kun: [] } };
        
        const primaryRadical = radicals[0] || '';
        
        nodes.push({
            id: kanji,
            char: kanji,
            radicals,
            primaryRadical,
            meanings: info.meanings,
            readings: info.readings,
            reviews: stats.reviews,
            lapses: stats.lapses,
            score,
            bucket,
            x: 0,
            y: 0
        });
    }
    
    // Layout nodes using force-directed placement based on semantic relationships
    const width = 1200;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Initialize random positions with padding
    const padding = 80;
    nodes.forEach(node => {
        node.x = padding + Math.random() * (width - padding * 2);
        node.y = padding + Math.random() * (height - padding * 2);
        node.vx = 0;
        node.vy = 0;
    });
    
    // Run simple force simulation for layout with stronger centering
    const iterations = 400;
    for (let iter = 0; iter < iterations; iter++) {
        const alpha = 1 - (iter / iterations); // Cooling
        
        // Repulsion between all nodes (stronger for more spacing)
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[j].x - nodes[i].x;
                const dy = nodes[j].y - nodes[i].y;
                const distSq = Math.max(dx * dx + dy * dy, 1);
                const dist = Math.sqrt(distSq);
                const force = (1200 / distSq) * alpha; // Increased repulsion for more spacing
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                
                nodes[i].vx -= fx;
                nodes[i].vy -= fy;
                nodes[j].vx += fx;
                nodes[j].vy += fy;
            }
        }
        
        // Stronger center gravity to keep nodes centered
        nodes.forEach(node => {
            const distFromCenter = Math.sqrt((node.x - centerX) ** 2 + (node.y - centerY) ** 2);
            const gravityStrength = 0.02 + (distFromCenter / width) * 0.03; // Stronger at edges
            node.vx += (centerX - node.x) * gravityStrength * alpha;
            node.vy += (centerY - node.y) * gravityStrength * alpha;
        });
        
        // Update positions with soft boundary constraints
        nodes.forEach(node => {
            node.x += node.vx;
            node.y += node.vy;
            node.vx *= 0.85;
            node.vy *= 0.85;
            
            // Soft boundary - push back if too close to edge
            const margin = padding;
            if (node.x < margin) node.vx += (margin - node.x) * 0.1;
            if (node.x > width - margin) node.vx -= (node.x - (width - margin)) * 0.1;
            if (node.y < margin) node.vy += (margin - node.y) * 0.1;
            if (node.y > height - margin) node.vy -= (node.y - (height - margin)) * 0.1;
        });
    }
    
    // Clean up velocity properties
    nodes.forEach(node => {
        delete node.vx;
        delete node.vy;
    });
    
    // Create edges - connect each node to 3-5 most similar neighbors
    const edges = [];
    const edgeSet = new Set();
    const maxEdgesPerNode = 4;
    
    for (const node of nodes) {
        const candidates = [];
        
        for (const other of nodes) {
            if (node.id === other.id) continue;
            
            const sharedRadicals = node.radicals.filter(r => other.radicals.includes(r)).length;
            const sameBucket = node.bucket === other.bucket ? 3 : 0;
            const similarity = sharedRadicals + sameBucket;
            
            if (similarity > 0) {
                candidates.push({ node: other, similarity });
            }
        }
        
        // Sort by similarity and take top N
        candidates.sort((a, b) => b.similarity - a.similarity);
        const topN = candidates.slice(0, maxEdgesPerNode);
        
        for (const { node: other, similarity } of topN) {
            const edgeId = [node.id, other.id].sort().join('-');
            if (!edgeSet.has(edgeId)) {
                edgeSet.add(edgeId);
                edges.push({
                    s: node.id,
                    t: other.id,
                    w: similarity
                });
            }
        }
    }
    
    return { nodes, edges };
}

// Main execution
try {
    const kradfilePath = join(rootDir, 'data', 'kradfile');
    const kanjidic2Path = join(rootDir, 'data', 'kanjidic2.xml');
    const ankiDataPath = join(rootDir, 'public', 'kanji.json');
    const outputPath = join(rootDir, 'public', 'kanji-graph.json');
    
    console.log('Parsing KRADFILE...');
    const kanjiToRadicals = parseKradfile(kradfilePath);
    console.log(`  Found ${Object.keys(kanjiToRadicals).length} kanji`);
    
    console.log('Parsing KANJIDIC2...');
    const kanjiData = parseKanjidic2(kanjidic2Path);
    console.log(`  Found ${Object.keys(kanjiData).length} kanji with metadata`);
    
    console.log('Loading Anki data...');
    const ankiData = loadAnkiData(ankiDataPath);
    console.log(`  Found ${Object.keys(ankiData).length} kanji with review stats`);
    
    console.log('Building graph...');
    
    // Debug: check overlap
    const kradKanji = Object.keys(kanjiToRadicals);
    const ankiKanji = Object.keys(ankiData);
    console.log(`  KRADFILE sample: ${kradKanji.slice(0, 5).join(', ')}`);
    console.log(`  Anki sample: ${ankiKanji.slice(0, 5).join(', ')}`);
    const overlap = ankiKanji.filter(k => kanjiToRadicals[k]);
    console.log(`  Overlap: ${overlap.length} kanji`);
    
    const graph = buildGraph(kanjiToRadicals, kanjiData, ankiData);
    console.log(`  Created ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
    
    console.log('Writing output...');
    writeFileSync(outputPath, JSON.stringify(graph, null, 2));
    console.log(`✓ Graph data written to ${outputPath}`);
    
} catch (error) {
    console.error('Error building kanji graph:', error);
    process.exit(1);
}
