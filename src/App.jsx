import { useState, useEffect, useCallback, useRef } from "react";

// --- CONFIG ---
const TABS = [
  { id: "all", label: "All" },
  { id: "breaking", label: "Breaking" },
  { id: "politics", label: "Politics" },
  { id: "world", label: "World" },
  { id: "economy", label: "Economy" },
  { id: "opinion", label: "Opinion" },
];

const DEFAULT_ACCOUNTS = [];

// Simple keyword-based categorizer
function categorize(text) {
  const t = text.toLowerCase();
  if (/breaking|just in|alert|urgent/i.test(t)) return "breaking";
  if (/senat|congress|house|vote|bill|elect|campaign|politi|president|governor|democrat|republican/i.test(t)) return "politics";
  if (/eu |nato|un |china|japan|india|russia|ukraine|gaza|diplomat|global|international|treaty/i.test(t)) return "world";
  if (/market|stock|gdp|inflation|fed |rate|economy|trade|debt|fiscal|employ|labor|jobs|earn/i.test(t)) return "economy";
  if (/thread|opinion|take|argue|think|analysis|perspective|unpopular/i.test(t)) return "opinion";
  return "breaking";
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// --- DEMO DATA (shown when no API token is set) ---
const DEMO_POSTS = [
  { id: "d1", author: "Reuters", handle: "@Reuters", time: "3m", category: "breaking", text: "BREAKING: Federal Reserve holds interest rates steady at current levels, citing persistent inflation concerns and mixed economic signals. Chair signals potential rate adjustments in Q3 pending further data review.", replies: 482, reposts: 1893, likes: 4201 },
  { id: "d2", author: "Associated Press", handle: "@AP", time: "11m", category: "politics", text: "Senate passes bipartisan infrastructure amendment with 68-32 vote. The measure allocates $42B toward modernizing transportation networks and expanding broadband access in underserved communities. Bill heads to the House for consideration next week.", replies: 215, reposts: 876, likes: 2104 },
  { id: "d3", author: "BBC Breaking News", handle: "@BBCBreaking", time: "18m", category: "world", text: "EU leaders reach consensus on new climate framework after marathon 14-hour negotiation session in Brussels. Agreement sets binding emissions reduction targets for member states through 2035, with penalties for non-compliance.", replies: 341, reposts: 1245, likes: 3890 },
  { id: "d4", author: "Bloomberg", handle: "@business", time: "24m", category: "economy", text: "US unemployment claims fall to lowest level since February, suggesting labor market resilience despite ongoing tech sector layoffs. Weekly initial claims dropped to 218,000, below economists' expectations of 230,000.", replies: 98, reposts: 412, likes: 1567 },
  { id: "d5", author: "Nate Silver", handle: "@NateSilver538", time: "32m", category: "opinion", text: "Thread on why the latest polling methodology changes matter more than people think:\n\n1/ Most major pollsters have shifted to probability-based panels, which should reduce the systematic errors we saw in recent cycles. But this introduces new problems.\n\n2/ The core issue is that probability panels have lower response rates among certain demographics — particularly younger voters and non-college-educated men.\n\n3/ What's genuinely encouraging is the move toward multi-mode contact strategies. Combining text, web, and phone outreach has shown 15-20% improvements in demographic representation.\n\n4/ Bottom line: methodology is getting better, but anyone claiming polls are now 'fixed' is overselling it.", replies: 567, reposts: 2341, likes: 8903, thread: true },
  { id: "d6", author: "The Economist", handle: "@TheEconomist", time: "41m", category: "world", text: "Analysis: Japan's central bank intervention signals a new phase in currency defense strategy. The yen's decline past the 158 mark against the dollar triggered what appears to be coordinated action with regional partners.", replies: 145, reposts: 623, likes: 2890 },
  { id: "d7", author: "Financial Times", handle: "@FT", time: "1h", category: "economy", text: "Global sovereign debt reaches record $92 trillion as governments grapple with competing demands of defense spending, climate transition, and aging populations. IMF warns that debt servicing costs are crowding out productive investment in emerging economies.", replies: 201, reposts: 945, likes: 3210 },
  { id: "d8", author: "Politico", handle: "@politico", time: "55m", category: "politics", text: "Exclusive: Draft executive order would establish new federal AI oversight board with authority to review and approve high-risk AI deployments in critical infrastructure. Sources say the proposal has divided White House advisors between innovation and safety camps.", replies: 432, reposts: 1876, likes: 5432 },
  { id: "d9", author: "Al Jazeera English", handle: "@AJEnglish", time: "1h", category: "world", text: "Diplomatic talks between regional powers enter third day in Geneva. Negotiators report 'meaningful progress' on ceasefire framework, though key sticking points remain on prisoner exchanges and humanitarian corridor access.", replies: 312, reposts: 1567, likes: 4321 },
  { id: "d10", author: "NPR Politics", handle: "@nprpolitics", time: "2h", category: "politics", text: "New campaign finance filings reveal record small-dollar donations across multiple competitive Senate races. The trend suggests heightened grassroots engagement ahead of the election cycle.", replies: 187, reposts: 654, likes: 2345 },
];

// --- X API FETCH LOGIC ---
async function fetchFromXApi(token, accounts, proxyUrl) {
  // X API v2 only allows up to ~512 chars in query, so batch if needed
  const batchSize = 15;
  let allPosts = [];

  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    const query = batch.map((a) => `from:${a}`).join(" OR ");
    const baseUrl = proxyUrl || "";
    const params = new URLSearchParams({
      query,
      "tweet.fields": "created_at,public_metrics,author_id,conversation_id",
      "user.fields": "name,username",
      "expansions": "author_id",
      "max_results": "50",
    });
    const endpoint = `${baseUrl}/2/tweets/search/recent?${params}`;

    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok && resp.status !== 304) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`X API ${resp.status}: ${errBody.substring(0, 200) || resp.statusText}`);
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        body.includes("<!DOCTYPE") || body.includes("<html")
          ? "Proxy returned an HTML page instead of JSON. Check that your proxy URL is correct and running."
          : `Unexpected response type (${contentType}): ${body.substring(0, 200)}`
      );
    }

    const json = await resp.json();
    const users = {};
    if (json.includes?.users) {
      json.includes.users.forEach((u) => { users[u.id] = u; });
    }

    const posts = (json.data || []).map((tweet) => {
      const user = users[tweet.author_id] || {};
      const m = tweet.public_metrics || {};
      return {
        id: tweet.id,
        author: user.name || "Unknown",
        handle: `@${user.username || "unknown"}`,
        time: timeAgo(tweet.created_at),
        category: categorize(tweet.text),
        text: tweet.text,
        replies: m.reply_count || 0,
        reposts: (m.retweet_count || 0) + (m.quote_count || 0),
        likes: m.like_count || 0,
        thread: tweet.text.includes("1/") || tweet.text.includes("\u{1F9F5}"),
      };
    });
    allPosts = [...allPosts, ...posts];
  }

  // Sort by newest first (X API returns sorted but batches may interleave)
  return allPosts;
}

// --- ACCOUNT MANAGER COMPONENT ---
function AccountManager({ accounts, onChange }) {
  const [input, setInput] = useState("");
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef(null);

  const addAccount = (raw) => {
    const val = raw.replace(/^@/, "").replace(/,/g, "").trim();
    if (val && !accounts.includes(val)) onChange([...accounts, val]);
    setInput("");
  };

  const removeAccount = (acc) => onChange(accounts.filter((a) => a !== acc));

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      if (input.trim()) addAccount(input);
    }
    if (e.key === "Backspace" && !input && accounts.length) {
      removeAccount(accounts[accounts.length - 1]);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const parts = pasted.split(/[,\s\n]+/).filter(Boolean);
    const newAccounts = [...accounts];
    parts.forEach((raw) => {
      const val = raw.replace(/^@/, "").trim();
      if (val && !newAccounts.includes(val)) newAccounts.push(val);
    });
    onChange(newAccounts);
    setInput("");
  };

  const visible = showAll ? accounts : accounts.slice(0, 20);
  const hiddenCount = accounts.length - 20;

  return (
    <div style={st.accManager}>
      <div style={st.accLabelRow}>
        <span style={st.accLabelText}>Following ({accounts.length} accounts)</span>
        <span style={st.accHint}>Type @handle + Enter · Paste a list · Comma or space separated</span>
      </div>
      <div style={st.accChipBox} onClick={() => inputRef.current?.focus()}>
        {visible.map((acc) => (
          <span key={acc} style={st.accChip}>
            <span style={st.accAt}>@</span>{acc}
            <button onClick={(e) => { e.stopPropagation(); removeAccount(acc); }} style={st.accX} aria-label={`Remove ${acc}`}>×</button>
          </span>
        ))}
        {!showAll && hiddenCount > 0 && (
          <button onClick={(e) => { e.stopPropagation(); setShowAll(true); }} style={st.accMore}>+{hiddenCount} more</button>
        )}
        {showAll && accounts.length > 20 && (
          <button onClick={(e) => { e.stopPropagation(); setShowAll(false); }} style={st.accMore}>Show less</button>
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => { if (input.trim()) addAccount(input); }}
          placeholder={accounts.length === 0 ? "e.g. Reuters, AP, BBCBreaking…" : "Add…"}
          style={st.accInputField}
        />
      </div>
      <div style={st.accActions}>
        <button onClick={() => onChange(DEFAULT_ACCOUNTS)} style={st.accBtn}>Load news defaults</button>
        <button onClick={() => { if (accounts.length === 0 || confirm(`Remove all ${accounts.length} accounts?`)) onChange([]); }} style={{ ...st.accBtn, color: "#dc2626" }}>Clear all</button>
      </div>
    </div>
  );
}

// --- MAIN APP ---
export default function App() {
  const [posts, setPosts] = useState(DEMO_POSTS);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedThread, setExpandedThread] = useState(null);
  const [savedPosts, setSavedPosts] = useState(new Set());
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [fetchSuccess, setFetchSuccess] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [apiConfig, setApiConfig] = useState({
    bearerToken: "",
    proxyUrl: "",
    refreshInterval: 60,
    accounts: DEFAULT_ACCOUNTS,
  });
  const intervalRef = useRef(null);
  const searchRef = useRef(null);
  const isConnected = !!apiConfig.bearerToken.trim();

  const filteredPosts = posts.filter((p) => {
    const matchTab = activeTab === "all" || p.category === activeTab;
    const matchSearch = !searchQuery ||
      p.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.author.toLowerCase().includes(searchQuery.toLowerCase());
    return matchTab && matchSearch;
  });

  const doRefresh = useCallback(async () => {
    if (!apiConfig.bearerToken.trim() || apiConfig.accounts.length === 0) return;
    setIsRefreshing(true);
    setFetchError(null);
    setFetchSuccess(null);
    try {
      const fetched = await fetchFromXApi(
        apiConfig.bearerToken.trim(),
        apiConfig.accounts,
        apiConfig.proxyUrl.trim() || null
      );
      if (fetched.length > 0) {
        setPosts(fetched);
        setFetchSuccess(`Loaded ${fetched.length} posts from ${apiConfig.accounts.length} accounts`);
        setTimeout(() => setFetchSuccess(null), 4000);
      } else {
        setFetchError("No tweets returned. Accounts may be private or have no recent posts.");
      }
      setLastRefresh(new Date());
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setIsRefreshing(false);
    }
  }, [apiConfig]);

  const handleRefresh = useCallback(() => {
    if (isConnected) {
      doRefresh();
    } else {
      setIsRefreshing(true);
      setTimeout(() => { setLastRefresh(new Date()); setIsRefreshing(false); }, 400);
    }
  }, [isConnected, doRefresh]);

  const toggleSave = (id) => {
    setSavedPosts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Auto-refresh timer
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (isLive && isConnected) {
      doRefresh();
      intervalRef.current = setInterval(doRefresh, apiConfig.refreshInterval * 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isLive, isConnected, apiConfig.refreshInterval, doRefresh]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        if (e.key === "Escape") { setSearchQuery(""); e.target.blur(); }
        return;
      }
      if (e.key === "r" || e.key === "R") handleRefresh();
      if (e.key === "l" || e.key === "L") setIsLive((p) => !p);
      if (e.key === "s" || e.key === "S" || e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleRefresh]);

  return (
    <div style={st.root}>
      <style>{globalCSS}</style>

      {/* HEADER */}
      <header style={st.header}>
        <div style={st.headerInner}>
          <div style={st.logoArea}>
            <h1 style={st.logo}>The Wire</h1>
            <span style={st.tagline}>curated briefing</span>
          </div>
          <div style={st.headerRight}>
            <span style={st.statusPill(isConnected)}>
              <span style={st.statusDot(isConnected)} />
              {isConnected ? "API Connected" : "Demo Mode"}
            </span>
            <span style={st.clock}>
              {isRefreshing ? "Updating…" : lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button onClick={handleRefresh} style={{ ...st.iconBtn, ...(isRefreshing ? { opacity: 0.4, pointerEvents: "none" } : {}) }} title="Refresh (R)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            </button>
            <button onClick={() => setIsLive(!isLive)} style={{ ...st.liveBtn, ...(isLive ? st.liveBtnOn : {}) }}>
              <span style={{ ...st.liveDot, ...(isLive ? st.liveDotOn : {}) }} />
              {isLive ? "LIVE" : "AUTO"}
            </button>
            <button onClick={() => setShowSettings(!showSettings)} style={{ ...st.iconBtn, ...(showSettings ? { background: "#f1f0ed" } : {}) }} title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* SUCCESS TOAST */}
      {fetchSuccess && (
        <div style={st.toast}>{fetchSuccess}</div>
      )}

      {/* SETTINGS PANEL */}
      {showSettings && (
        <div style={st.settingsPanel}>
          <div style={st.settingsInner}>
            <div style={{ marginBottom: 16 }}>
              <h3 style={st.settingsTitle}>X API Configuration</h3>
              <p style={st.settingsDesc}>
                Connect to the X API v2 for live tweet feeds. Get a bearer token at{" "}
                <span style={{ textDecoration: "underline" }}>developer.x.com</span>
              </p>
            </div>

            {fetchError && (
              <div style={st.errorBox}>
                <strong>Error:</strong> {fetchError}
              </div>
            )}

            <div style={st.fieldGroup}>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ ...st.label, flex: 2 }}>
                  <span>Bearer Token</span>
                  <input type="password" placeholder="Paste your X API v2 bearer token" value={apiConfig.bearerToken} onChange={(e) => setApiConfig({ ...apiConfig, bearerToken: e.target.value })} style={st.input} />
                </label>
                <label style={{ ...st.label, flex: 1 }}>
                  <span>Refresh (sec)</span>
                  <input type="number" min="15" max="300" value={apiConfig.refreshInterval} onChange={(e) => setApiConfig({ ...apiConfig, refreshInterval: +e.target.value })} style={st.input} />
                </label>
              </div>

              <label style={st.label}>
                <span>CORS Proxy URL (required — see below)</span>
                <input type="text" placeholder="https://your-proxy.workers.dev" value={apiConfig.proxyUrl} onChange={(e) => setApiConfig({ ...apiConfig, proxyUrl: e.target.value })} style={st.input} />
              </label>

              <AccountManager
                accounts={apiConfig.accounts}
                onChange={(accs) => setApiConfig({ ...apiConfig, accounts: accs })}
              />
            </div>

            {isConnected && (
              <button onClick={doRefresh} disabled={isRefreshing} style={st.fetchBtn}>
                {isRefreshing ? "Fetching…" : `Fetch now from ${apiConfig.accounts.length} accounts`}
              </button>
            )}

            <div style={st.warnBox}>
              <strong>CORS Proxy Required</strong>
              <p style={{ margin: "4px 0 0" }}>
                Browsers block direct calls to api.x.com. Deploy this Cloudflare Worker (free) as your proxy:
              </p>
            </div>
            <div style={st.codeWrap}>
              <code style={st.code}>
{`// Cloudflare Worker — deploy at your-proxy.workers.dev
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://api.x.com" + url.pathname + url.search;
    const resp = await fetch(target, {
      headers: {
        "Authorization": request.headers.get("Authorization"),
        "Content-Type": "application/json",
      },
    });
    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  },
};`}
              </code>
            </div>
          </div>
        </div>
      )}

      {/* NAV TABS */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <div style={st.tabs}>
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ ...st.tab, ...(activeTab === tab.id ? st.tabOn : {}) }}>
                {tab.label}
                {tab.id !== "all" && <span style={st.tabCount}>{posts.filter((p) => p.category === tab.id).length}</span>}
              </button>
            ))}
          </div>
          <div style={st.searchWrap}>
            <svg style={st.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input ref={searchRef} type="text" placeholder="Search… (S)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={st.searchInput} />
            {searchQuery && <button onClick={() => setSearchQuery("")} style={st.searchX}>×</button>}
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main style={st.main}>
        <div style={st.feed}>
          {filteredPosts.length === 0 && <div style={st.empty}>No posts match your filter.</div>}
          {filteredPosts.map((post, i) => (
            <article key={post.id} className="card-enter" style={{ ...st.card, animationDelay: `${i * 0.04}s` }}>
              <div style={st.cardTop}>
                <div style={st.authorRow}>
                  <div style={st.avatar}>{post.author.charAt(0)}</div>
                  <div>
                    <span style={st.authorName}>{post.author}</span>
                    <span style={st.handle}>{post.handle}</span>
                  </div>
                </div>
                <div style={st.cardMeta}>
                  <span style={st.badge}>{post.category}</span>
                  <span style={st.time}>{post.time}</span>
                </div>
              </div>
              <p style={st.text}>{post.text}</p>
              {post.thread && (
                <button onClick={() => setExpandedThread(expandedThread === post.id ? null : post.id)} style={st.threadBtn}>
                  {expandedThread === post.id ? "Collapse thread ↑" : "Show full thread ↓"}
                </button>
              )}
              <div style={st.cardBot}>
                <div style={st.metrics}>
                  <span style={st.metric}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>{formatNumber(post.replies)}</span>
                  <span style={st.metric}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>{formatNumber(post.reposts)}</span>
                  <span style={st.metric}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>{formatNumber(post.likes)}</span>
                </div>
                <button onClick={() => toggleSave(post.id)} style={{ ...st.saveBtn, ...(savedPosts.has(post.id) ? st.saveBtnOn : {}) }} title="Bookmark">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={savedPosts.has(post.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                </button>
              </div>
            </article>
          ))}
        </div>

        {/* SIDEBAR */}
        <aside style={st.sidebar}>
          {!isConnected && (
            <div style={{ ...st.sideCard, background: "#fffbeb", borderColor: "#fbbf24" }}>
              <h3 style={{ ...st.sideTitle, color: "#92400e" }}>Demo Mode</h3>
              <p style={{ fontSize: 13, color: "#92400e", lineHeight: 1.5 }}>
                Showing sample data. Open <strong>⚙ Settings</strong> to connect your X API token and start fetching live tweets.
              </p>
            </div>
          )}
          <div style={st.sideCard}>
            <h3 style={st.sideTitle}>Bookmarks</h3>
            {savedPosts.size === 0 ? (
              <p style={st.sideText}>Click the bookmark icon on any post.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {posts.filter((p) => savedPosts.has(p.id)).map((p) => (
                  <div key={p.id} style={st.bmItem}>
                    <span style={st.bmAuthor}>{p.author}</span>
                    <p style={st.bmSnippet}>{p.text.substring(0, 90)}…</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={st.sideCard}>
            <h3 style={st.sideTitle}>Shortcuts</h3>
            <div style={st.scList}>
              {[["R", "Refresh"], ["L", "Toggle live"], ["S", "Search"], ["Esc", "Clear"]].map(([k, d]) => (
                <div key={k} style={st.scRow}><kbd style={st.kbd}>{k}</kbd><span style={st.scDesc}>{d}</span></div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <footer style={st.footer}>
        <span>The Wire — Text-only news reader</span>
        <span style={{ opacity: 0.3 }}>·</span>
        <span>X API v2</span>
        <span style={{ opacity: 0.3 }}>·</span>
        <span>{posts.length} posts</span>
      </footer>
    </div>
  );
}

// --- CSS ---
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @keyframes cardEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .card-enter { animation: cardEnter 0.3s ease-out both; }
  input::placeholder { color: #94a3b8; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
`;

const c = { bg: "#f8f7f4", surface: "#ffffff", border: "#e8e5df", text: "#1a1a1a", textMd: "#475569", textLt: "#94a3b8", accent: "#d4533b", accentSoft: "#fef2f0", green: "#16a34a", greenSoft: "#f0fdf4" };

const st = {
  root: { fontFamily: "'DM Sans', -apple-system, sans-serif", background: c.bg, color: c.text, minHeight: "100vh", lineHeight: 1.6 },
  header: { background: c.surface, borderBottom: `1px solid ${c.border}`, position: "sticky", top: 0, zIndex: 100 },
  headerInner: { maxWidth: 1120, margin: "0 auto", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  logoArea: { display: "flex", alignItems: "baseline", gap: 10 },
  logo: { fontFamily: "'Newsreader', Georgia, serif", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" },
  tagline: { fontSize: 10, fontWeight: 600, color: c.textLt, textTransform: "uppercase", letterSpacing: "0.1em" },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  statusPill: (on) => ({ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, letterSpacing: "0.02em", background: on ? c.greenSoft : "#f8f8f6", color: on ? c.green : c.textLt, border: `1px solid ${on ? "#bbf7d0" : c.border}` }),
  statusDot: (on) => ({ width: 6, height: 6, borderRadius: "50%", background: on ? c.green : c.textLt, ...(on ? { boxShadow: `0 0 0 2px ${c.greenSoft}` } : {}) }),
  clock: { fontSize: 11, color: c.textLt, marginRight: 2 },
  iconBtn: { background: "none", border: `1px solid ${c.border}`, borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: c.textMd, display: "flex", alignItems: "center", transition: "all 0.15s" },
  liveBtn: { background: "none", border: `1px solid ${c.border}`, borderRadius: 8, padding: "5px 11px", cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: c.textLt, display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif" },
  liveBtnOn: { background: c.greenSoft, borderColor: c.green, color: c.green },
  liveDot: { width: 6, height: 6, borderRadius: "50%", background: c.textLt, transition: "all 0.2s" },
  liveDotOn: { background: c.green, boxShadow: `0 0 0 2px ${c.greenSoft}, 0 0 6px ${c.green}` },

  // Toast
  toast: { maxWidth: 1120, margin: "0 auto", padding: "8px 24px" , display: "flex", justifyContent: "center" },

  // Settings
  settingsPanel: { background: "#fafaf8", borderBottom: `1px solid ${c.border}` },
  settingsInner: { maxWidth: 1120, margin: "0 auto", padding: "20px 24px" },
  settingsTitle: { fontFamily: "'Newsreader', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 4 },
  settingsDesc: { fontSize: 13, color: c.textMd },
  errorBox: { background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14, lineHeight: 1.5 },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 500, color: c.textMd },
  input: { padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.border}`, fontSize: 13, fontFamily: "'DM Sans', sans-serif", background: c.surface, outline: "none" },
  fetchBtn: { background: c.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 16 },
  warnBox: { fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 10, lineHeight: 1.5 },
  codeWrap: { background: "#1e293b", borderRadius: 8, padding: "14px 16px", overflowX: "auto", whiteSpace: "pre", lineHeight: 1.6 },
  code: { fontSize: 11.5, color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" },

  // Account Manager
  accManager: { display: "flex", flexDirection: "column", gap: 6 },
  accLabelRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  accLabelText: { fontSize: 12, fontWeight: 500, color: c.textMd },
  accHint: { fontSize: 11, color: c.textLt },
  accChipBox: { display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, minHeight: 42, maxHeight: 180, overflowY: "auto", cursor: "text", alignItems: "center", alignContent: "flex-start" },
  accChip: { display: "inline-flex", alignItems: "center", gap: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 5, padding: "2px 7px 2px 5px", fontSize: 12, fontWeight: 500, color: "#334155", whiteSpace: "nowrap", lineHeight: "20px" },
  accAt: { color: c.textLt, fontWeight: 400 },
  accX: { background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, lineHeight: 1, marginLeft: 3, padding: "0 2px" },
  accMore: { background: "none", border: `1px dashed ${c.border}`, borderRadius: 5, padding: "2px 10px", fontSize: 11, color: c.accent, cursor: "pointer", fontWeight: 500, fontFamily: "'DM Sans', sans-serif" },
  accInputField: { border: "none", outline: "none", fontSize: 13, fontFamily: "'DM Sans', sans-serif", flex: 1, minWidth: 100, background: "transparent", padding: "2px 0" },
  accActions: { display: "flex", gap: 12 },
  accBtn: { background: "none", border: "none", fontSize: 12, color: c.accent, cursor: "pointer", fontWeight: 500, fontFamily: "'DM Sans', sans-serif", padding: 0 },

  // Nav
  nav: { background: c.surface, borderBottom: `1px solid ${c.border}` },
  navInner: { maxWidth: 1120, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  tabs: { display: "flex" },
  tab: { background: "none", border: "none", borderBottom: "2px solid transparent", padding: "11px 14px", fontSize: 13, fontWeight: 500, color: c.textLt, cursor: "pointer", transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 6 },
  tabOn: { color: c.text, borderBottomColor: c.accent },
  tabCount: { fontSize: 10, fontWeight: 600, background: "#f1f5f9", color: c.textMd, borderRadius: 10, padding: "1px 6px", lineHeight: "16px" },
  searchWrap: { position: "relative" },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: c.textLt, pointerEvents: "none" },
  searchInput: { padding: "7px 28px 7px 30px", borderRadius: 8, border: `1px solid ${c.border}`, fontSize: 13, fontFamily: "'DM Sans', sans-serif", width: 190, background: c.bg, outline: "none" },
  searchX: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", fontSize: 16, color: c.textLt, cursor: "pointer", padding: "0 4px" },

  // Main
  main: { maxWidth: 1120, margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 },
  feed: { display: "flex", flexDirection: "column", gap: 2 },
  empty: { textAlign: "center", padding: 48, color: c.textLt, fontSize: 14 },

  // Card
  card: { background: c.surface, borderRadius: 10, padding: "18px 20px", border: `1px solid ${c.border}` },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  authorRow: { display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${c.accent}, #e8845a)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  authorName: { fontSize: 13.5, fontWeight: 600, display: "block", lineHeight: 1.2 },
  handle: { fontSize: 11.5, color: c.textLt },
  cardMeta: { display: "flex", alignItems: "center", gap: 8 },
  badge: { fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: 4, background: c.accentSoft, color: c.accent },
  time: { fontSize: 11.5, color: c.textLt },
  text: { fontFamily: "'Newsreader', Georgia, serif", fontSize: 15, lineHeight: 1.72, color: c.text, whiteSpace: "pre-line" },
  threadBtn: { background: "none", border: "none", color: c.accent, fontSize: 13, fontWeight: 500, cursor: "pointer", padding: "8px 0 0", fontFamily: "'DM Sans', sans-serif" },
  cardBot: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.border}` },
  metrics: { display: "flex", gap: 16 },
  metric: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.textLt },
  saveBtn: { background: "none", border: "none", color: c.textLt, cursor: "pointer", padding: 4, borderRadius: 4, transition: "color 0.15s" },
  saveBtnOn: { color: c.accent },

  // Sidebar
  sidebar: { display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 80, alignSelf: "start" },
  sideCard: { background: c.surface, borderRadius: 10, border: `1px solid ${c.border}`, padding: "14px 16px" },
  sideTitle: { fontFamily: "'Newsreader', Georgia, serif", fontSize: 14.5, fontWeight: 600, marginBottom: 8 },
  sideText: { fontSize: 12.5, color: c.textLt, lineHeight: 1.5 },
  bmItem: { padding: "7px 0", borderBottom: `1px solid ${c.border}` },
  bmAuthor: { fontSize: 11.5, fontWeight: 600 },
  bmSnippet: { fontSize: 12, color: c.textMd, marginTop: 2, lineHeight: 1.4 },
  scList: { display: "flex", flexDirection: "column", gap: 7 },
  scRow: { display: "flex", alignItems: "center", gap: 10 },
  kbd: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 21, padding: "0 6px", background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: c.textMd },
  scDesc: { fontSize: 12, color: c.textLt },
  footer: { maxWidth: 1120, margin: "0 auto", padding: "20px 24px 32px", fontSize: 11.5, color: c.textLt, display: "flex", gap: 8, justifyContent: "center" },
};
