import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { search } from '../lib/search.js';
import { NavHead, Icon, ProductCard } from '../components/ui.jsx';

const TAG_LABEL = { bestseller: 'Populiariausi', 'veganiška': 'Veganiška', 'vegetariška': 'Vegetariška', 'aštru': 'Aštru', naujiena: 'Naujiena', sezoninis: 'Sezoninis' };

export default function Menu() {
  const { menu, store } = useApp();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [showFilters, setShowFilters] = useState(params.get('filters') === '1');
  const [tags, setTags] = useState(new Set());
  const [active, setActive] = useState(null);
  const refs = useRef({});
  const inputRef = useRef(null);

  useEffect(() => { if (params.get('q') !== null) inputRef.current?.focus(); }, []); // eslint-disable-line

  const allTags = useMemo(() => [...new Set((menu?.items || []).flatMap((i) => i.tags))].filter((t) => TAG_LABEL[t]), [menu]);
  const filtered = useMemo(() => {
    if (!menu) return [];
    let list = tags.size ? menu.items.filter((i) => [...tags].every((t) => i.tags.includes(t))) : menu.items;
    if (q.trim()) list = search(list, q);
    return list;
  }, [menu, q, tags]);
  const flat = q.trim() || tags.size;

  useEffect(() => {
    if (!menu || flat) return;
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.dataset.slug);
    }, { rootMargin: '-180px 0px -55% 0px' });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [menu, flat]);

  useEffect(() => {
    const slug = loc.hash.slice(1);
    if (slug && menu) setTimeout(() => jump(slug), 60);
  }, [loc.hash, menu]); // eslint-disable-line

  useEffect(() => {
    document.querySelector(`.menu-cats [data-slug="${active}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  function jump(slug) {
    const el = refs.current[slug];
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: 'smooth' });
  }
  const toggleTag = (t) => setTags((p) => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <>
      <NavHead title="Meniu" sub={store?.name} back="/" />
      <div style={{ padding: '6px 20px 0' }}>
        <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); }}>
          <Icon.search />
          <input ref={inputRef} type="search" placeholder="Burgeris, veganiška, kava…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Paieška" />
          <button type="button" className={`circle ${showFilters || tags.size ? 'dark' : ''}`} style={{ boxShadow: showFilters || tags.size ? 'none' : 'inset 0 0 0 1px var(--line)' }}
            onClick={() => setShowFilters((v) => !v)} aria-label="Filtrai" aria-expanded={showFilters}><Icon.filter /></button>
        </form>
      </div>
      {showFilters && (
        <div className="chips" style={{ margin: '12px 0 0', padding: '0 20px' }}>
          {allTags.map((t) => <button key={t} className={`chip sm${tags.has(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{TAG_LABEL[t]}</button>)}
          {tags.size > 0 && <button className="chip sm" onClick={() => setTags(new Set())}>Išvalyti</button>}
        </div>
      )}
      {!flat && menu && (
        <nav className="chips menu-cats" aria-label="Kategorijos"
          style={{ position: 'sticky', top: 'calc(72px + var(--safe-t))', zIndex: 15, background: 'var(--bg)', margin: 0, padding: '12px 20px 10px' }}>
          {menu.categories.map((c) => (
            <button key={c.id} data-slug={c.slug} className={`chip${active === c.slug ? ' on' : ''}`} onClick={() => jump(c.slug)}>{c.name}</button>
          ))}
        </nav>
      )}
      <div className="page" style={{ paddingTop: 10 }}>
        {!menu && <div className="pgrid">{[0, 1, 2, 3].map((k) => <div key={k} className="skeleton" style={{ height: 250 }} />)}</div>}
        {menu && flat ? (
          <section className="col" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>{filtered.length ? `Rasta: ${filtered.length}` : 'Nieko nerasta. Pabandykite kitaip.'}</p>
            <div className="pgrid">{filtered.map((it) => <ProductCard key={it.id} item={it} grid />)}</div>
          </section>
        ) : menu?.categories.map((c) => {
          const list = menu.items.filter((i) => i.categoryId === c.id);
          if (!list.length) return null;
          return (
            <section key={c.id} ref={(el) => { refs.current[c.slug] = el; }} data-slug={c.slug} className="col" style={{ gap: 14 }}>
              <h2>{c.name}</h2>
              <div className="pgrid">{list.map((it) => <ProductCard key={it.id} item={it} grid />)}</div>
            </section>
          );
        })}
      </div>
    </>
  );
}
