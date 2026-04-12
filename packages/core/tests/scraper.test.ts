import { describe, it, expect } from 'vitest';
import {
  parseRegulationPage,
  extractDefinitions,
  extractCrossReferences,
  stripHtml,
} from '../src/scraper.js';

const SAMPLE_HTML = `<html><body><article>
  <h1>AFS 2006:1 Asbest</h1>
  <h2>1 kap. Tillamplighetsomrade</h2>
  <p>1 § Dessa foreskrifter galler for verksamhet dar exponering for asbest kan forekomma.</p>
  <p>2 § Med asbest avses i dessa foreskrifter fibrost silikatmineral.</p>
  <h2>2 kap. Definitioner</h2>
  <p>3 § I dessa foreskrifter avses med</p>
  <p><strong>asbest</strong>: fibrost silikatmineral tillhorande serpentin- eller amfibolgruppen.</p>
  <p><strong>hygieniskt gransvarde</strong>: hogsta tillaten genomsnittshalt.</p>
  <h2>3 kap. Rivning och sanering</h2>
  <p>7 § Rivning av asbesthaltigt material far inte utforas utan tillstand. Se aven SFS 1977:1160 och direktiv 2009/148/EG.</p>
</article></body></html>`;

describe('stripHtml', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<p>foo &amp; bar</p>')).toBe('foo & bar');
    expect(stripHtml('<strong>hello</strong>')).toBe('hello');
    expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
  });
});

describe('parseRegulationPage', () => {
  it('extracts sections from sample HTML', () => {
    const sections = parseRegulationPage(SAMPLE_HTML, 'AFS-2006-1');
    expect(sections.length).toBeGreaterThan(0);

    // Should find numbered paragraphs
    const paraIds = sections
      .filter((s) => s.section_type === 'paragraf')
      .map((s) => s.number);
    expect(paraIds).toContain('1');
    expect(paraIds).toContain('2');
    expect(paraIds).toContain('7');
  });

  it('assigns chapter as section_type', () => {
    const sections = parseRegulationPage(SAMPLE_HTML, 'AFS-2006-1');
    const chapters = sections.filter((s) => s.section_type === 'chapter');
    expect(chapters.length).toBeGreaterThanOrEqual(3);

    const chapterNumbers = chapters.map((c) => c.number);
    expect(chapterNumbers).toContain('1');
    expect(chapterNumbers).toContain('2');
    expect(chapterNumbers).toContain('3');
  });

  it('sets parent_id for paragraphs under chapters', () => {
    const sections = parseRegulationPage(SAMPLE_HTML, 'AFS-2006-1');
    const para1 = sections.find(
      (s) => s.section_type === 'paragraf' && s.number === '1',
    );
    expect(para1).toBeDefined();
    expect(para1!.parent_id).toBe('AFS-2006-1/kap-1');
  });

  it('generates correct section IDs with chapter context', () => {
    const sections = parseRegulationPage(SAMPLE_HTML, 'AFS-2006-1');
    const para7 = sections.find(
      (s) => s.section_type === 'paragraf' && s.number === '7',
    );
    expect(para7).toBeDefined();
    expect(para7!.id).toBe('AFS-2006-1/kap-3/p-7');
  });

  it('falls back to full html when no <article> tag', () => {
    const noArticle = `<h2>1 kap. Test</h2><p>1 § Body text.</p>`;
    const sections = parseRegulationPage(noArticle, 'TEST-1');
    expect(sections.length).toBeGreaterThan(0);
  });
});

describe('extractDefinitions', () => {
  it('finds defined terms', () => {
    const defs = extractDefinitions(SAMPLE_HTML, 'AFS-2006-1');
    const terms = defs.map((d) => d.term);
    expect(terms).toContain('asbest');
    expect(terms).toContain('hygieniskt gransvarde');
  });

  it('returns regulation_id on each definition', () => {
    const defs = extractDefinitions(SAMPLE_HTML, 'AFS-2006-1');
    for (const d of defs) {
      expect(d.regulation_id).toBe('AFS-2006-1');
    }
  });
});

describe('extractCrossReferences', () => {
  it('finds SFS references', () => {
    const refs = extractCrossReferences(SAMPLE_HTML, 'AFS-2006-1');
    const sfsRefs = refs.filter((r) => r.target_type === 'sfs');
    expect(sfsRefs.length).toBeGreaterThan(0);
    expect(sfsRefs.some((r) => r.target_id === 'SFS 1977:1160')).toBe(true);
  });

  it('finds EU directive references', () => {
    const refs = extractCrossReferences(SAMPLE_HTML, 'AFS-2006-1');
    const euRefs = refs.filter((r) => r.target_type === 'eu_directive');
    expect(euRefs.length).toBeGreaterThan(0);
    expect(
      euRefs.some((r) => r.target_id === 'direktiv 2009/148/EG'),
    ).toBe(true);
  });

  it('deduplicates by target_id', () => {
    const doubled = `<p>See SFS 1977:1160 and SFS 1977:1160 again.</p>`;
    const refs = extractCrossReferences(doubled, 'TEST');
    const sfsRefs = refs.filter((r) => r.target_type === 'sfs');
    expect(sfsRefs).toHaveLength(1);
  });

  it('finds SIS standard references', () => {
    const withSis = `<p>Enligt SS-EN 14042 och SS 12345.</p>`;
    const refs = extractCrossReferences(withSis, 'TEST');
    const sisRefs = refs.filter((r) => r.target_type === 'sis_standard');
    expect(sisRefs).toHaveLength(2);
  });
});
