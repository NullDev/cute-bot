import re
import sys
import json
import math
import random
import sqlite3
import os
from collections import defaultdict, deque, Counter
from difflib import get_close_matches
from typing import List, Optional, Dict, Tuple
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion
from sklearn.metrics.pairwise import cosine_similarity

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data")
DB_PATH = os.path.join(_BASE, "brain.sqlite")
EMOJI_PATH = os.path.join(_BASE, "emojis.json")

# Messages that are commands for other bots ("g.p", "t!rank", ";play", ...). Must match MsgLearn.js isBotCommand.
BOT_COMMAND_RE = re.compile(r"^(?:g\.|t!|m!|o-|t-|;|!|\$)[a-z0-9]", re.I)
# The bot must never say these, no matter what the corpus contains. Extend as needed.
REPLY_BLOCKLIST_RE = re.compile(r"n[i1]gg|f[a4]gg?[o0]t|retard|tr[a4]nn[yi]|\bkys\b|\bkill yourself\b", re.I)
# Leftover junk markers like "[345]" from crawled logs.
TAG_RE = re.compile(r"\[\d+\]")

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "so", "to", "of", "in", "on", "at", "for", "with",
    "is", "are", "am", "was", "were", "be", "been", "it", "its", "this", "that", "i", "im", "i'm",
    "you", "u", "ur", "your", "me", "my", "we", "he", "she", "they", "them", "do", "does", "did",
    "just", "like", "lol", "lmao", "yeah", "yea", "ok", "oh", "not", "no", "yes", "what", "why",
    "how", "who", "when", "where", "which", "can", "could", "would", "should", "have", "has", "had",
    "get", "got", "go", "up", "out", "about", "really", "very", "too", "also", "than", "then",
}

class EmojiResolver:
    def __init__(self, path: str = EMOJI_PATH):
        with open(path, encoding="utf-8") as f:
            self._map = json.load(f) # {":name:": "<a:name:id>"}
        # strip colons for fuzzy lookup
        self._names = [k.strip(":") for k in self._map]

    def resolve(self, text: str) -> str:
        def replace(m):
            token = m.group(0) # e.g. ":cryingcat:"
            name = m.group(1)  # e.g. "cryingcat"
            # exact match
            if token in self._map:
                return self._map[token]
            # fuzzy match (cutoff 0.6 - close enough for short names)
            close = get_close_matches(name, self._names, n=1, cutoff=0.6)
            if close:
                return self._map[f":{close[0]}:"]
            # no match - drop it
            return ""
        return re.sub(r":([A-Za-z0-9_]+):", replace, text).strip()

def normalize(text: str) -> str:
    text = (text or "").lower().strip()      # lowercase and trim
    text = re.sub(r"<@!?\d+>", "", text)     # remove Discord mentions
    text = re.sub(r"<a?:\w+:\d+>", "", text) # remove custom emojis
    text = re.sub(r"https?://\S+", "", text) # remove URLs
    text = TAG_RE.sub("", text)              # remove "[123]" tags
    text = re.sub(r"\s+", " ", text).strip() # collapse whitespace
    return text

def tokenize(text: str) -> List[str]:
    return normalize(text).split()

def content_tokens(text: str) -> List[str]:
    return [t for t in tokenize(text) if t not in STOPWORDS and len(t) > 1]

def is_question(text: str) -> bool:
    t = normalize(text)
    words = set(t.split())
    return "?" in (text or "") or any(w in words for w in [
        "why", "how", "who", "where", "when", "what", "which",
        "whom", "whose", "huh", "wut", "wat", "can", "could",
        "would", "should", "do", "does", "did", "is", "are",
    ])

def lexical_overlap(a: str, b: str) -> float:
    aa = set(tokenize(a))
    bb = set(tokenize(b))
    if not aa or not bb:
        return 0.0
    return len(aa & bb) / len(aa | bb)

def content_coverage(inp: str, parent: str) -> Optional[float]:
    """Fraction of the input's content words that also appear in the parent. None if the input has none."""
    ct = content_tokens(inp)
    if not ct:
        return None
    pt = set(tokenize(parent))
    return sum(1 for t in ct if t in pt) / len(ct)

def looks_generic(text: str) -> bool:
    toks = tokenize(text)
    generic = {
        "ye", "yea", "yeah", "yes", "nah", "no", "lol", "kk",
        "okay", "k", "xd", "lmao", "hehe", "fr", "real",
        "true", "fair", "crazy", "wild", "ok", "oh", "what",
    }
    return len(toks) <= 2 and all(tok in generic for tok in toks)

def looks_uncertain_reply(text: str) -> bool:
    t = normalize(text)
    if not t: return False
    markers = [
        "idk", "i dont know", "i don't know", "maybe", "probably",
        "bro what", "what", "huh", "wtf", "no clue", "unsure",
        "confused", "uh", "hmmm", "i think", "2 maybe",
    ]
    return any(m in t for m in markers)

def is_junk(text: str) -> bool:
    """Never learn from or say these."""
    if not text:
        return True
    if BOT_COMMAND_RE.match(text.strip()):
        return True
    return False

def is_blocked_reply(text: str) -> bool:
    return bool(REPLY_BLOCKLIST_RE.search(text or ""))

class MarkovBrain:
    def __init__(self):
        self.trigrams: Dict[Tuple[str, str], List[str]] = defaultdict(list)
        self.bigrams: Dict[str, List[str]] = defaultdict(list)
        self.starters: List[Tuple[str, ...]] = []

    def train(self, messages: List[str]):
        self.trigrams.clear()
        self.bigrams.clear()
        self.starters.clear()
        for msg in messages:
            words = tokenize(msg)
            if not words: continue
            if len(words) >= 2: self.starters.append((words[0], words[1]))
            else: self.starters.append((words[0],))
            for i in range(len(words)):
                if i + 2 < len(words):
                    self.trigrams[(words[i], words[i + 1])].append(words[i + 2])
                if i + 1 < len(words):
                    self.bigrams[words[i]].append(words[i + 1])

    def generate(self, seed: str = "", max_words: int = 20) -> str:
        words = tokenize(seed)
        result: List[str] = []
        if len(words) >= 2 and (words[-2], words[-1]) in self.trigrams:
            result = [words[-2], words[-1]]
        elif len(words) >= 1 and words[-1] in self.bigrams:
            result = [words[-1]]
        elif self.starters:
            result = list(random.choice(self.starters))
        else:
            return ""
        while len(result) < max_words:
            if len(result) >= 2 and (result[-2], result[-1]) in self.trigrams:
                nxt = random.choice(self.trigrams[(result[-2], result[-1])])
            elif result[-1] in self.bigrams:
                nxt = random.choice(self.bigrams[result[-1]])
            else:
                break
            if len(result) >= 3 and nxt == result[-1] == result[-2]:
                break
            result.append(nxt)
            if len(result) >= 5 and random.random() < 0.22:
                break
        return " ".join(result).strip()

    def continue_from(self, prefix: str, extra_words: int = 8) -> str:
        base = tokenize(prefix)
        if not base:
            return ""
        result = base[:]
        while len(result) < len(base) + extra_words:
            if len(result) >= 2 and (result[-2], result[-1]) in self.trigrams:
                nxt = random.choice(self.trigrams[(result[-2], result[-1])])
            elif result[-1] in self.bigrams:
                nxt = random.choice(self.bigrams[result[-1]])
            else:
                break
            if nxt in result[-4:]:
                break
            result.append(nxt)
            if len(result) >= len(base) + 3 and random.random() < 0.35:
                break
        return " ".join(result).strip()

class RetrievalBrain:
    """
    TF-IDF retrieval over *unique* parent messages. Each parent maps to every reply
    it ever received, so the same parent never competes against itself in the ranking
    and the reply choice is a separate, explicit step.
    """
    def __init__(self):
        self.parents: List[str] = []
        # per parent index: list of (raw_reply, reply_norm)
        self.replies: List[List[Tuple[str, str]]] = []
        self.reply_freq: Counter = Counter()
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.matrix = None

    def train(self, keys: List[str], replies: List[str]):
        grouped: Dict[str, Dict[str, str]] = defaultdict(dict)
        self.reply_freq = Counter()
        for k, r in zip(keys, replies):
            nk = normalize(k)
            nr = normalize(r)
            if not nk or not nr or nk == nr:
                continue
            self.reply_freq[nr] += 1
            grouped[nk].setdefault(nr, r)  # dedupe identical replies under the same parent
        self.parents = list(grouped.keys())
        self.replies = [list((raw, nr) for nr, raw in grouped[p].items()) for p in self.parents]
        if not self.parents:
            self.vectorizer = None
            self.matrix = None
            return
        self.vectorizer = FeatureUnion([
            ("word", TfidfVectorizer(
                analyzer="word",
                ngram_range=(1, 2),
                min_df=2,
                sublinear_tf=True,
            )),
            ("char", TfidfVectorizer(
                analyzer="char_wb",
                ngram_range=(3, 5),
                min_df=2,
                sublinear_tf=True,
            )),
        ])
        self.matrix = self.vectorizer.fit_transform(self.parents)

    def _query_sims(self, text: str) -> np.ndarray:
        if self.vectorizer is None or self.matrix is None or not normalize(text):
            return np.array([])
        vec = self.vectorizer.transform([normalize(text)])
        return cosine_similarity(vec, self.matrix).flatten()

    def top_parents(self, text: str, context: Optional[List[str]] = None, limit: int = 25) -> List[Tuple[int, float]]:
        if self.vectorizer is None or self.matrix is None:
            return []
        context = context or []
        q0 = normalize(text)
        if not q0:
            return []
        sims = self._query_sims(q0)
        if sims.size == 0:
            return []
        # weighted multi-query instead of one mushy concatenated blob
        if context:
            prev1 = normalize(context[0]) if len(context) >= 1 else ""
            prev2 = normalize(context[1]) if len(context) >= 2 else ""
            if prev1:
                s1 = self._query_sims(f"{prev1} {q0}".strip())
                if s1.size == sims.size:
                    sims = (sims * 0.80) + (s1 * 0.20)
            if prev2 and prev1:
                s2 = self._query_sims(f"{prev2} {prev1} {q0}".strip())
                if s2.size == sims.size:
                    sims = (sims * 0.95) + (s2 * 0.05)
        if limit < sims.size:
            idx = np.argpartition(-sims, limit)[:limit]
        else:
            idx = np.arange(sims.size)
        order = idx[np.argsort(-sims[idx])]
        return [(int(i), float(sims[i])) for i in order if sims[i] > 0]

class Brain:
    # retrieval below this best-candidate score is treated as "no idea" -> fallback
    RETRIEVAL_FLOOR = 1.05
    # candidates within this distance of the best are all considered good answers
    BAND_WIDTH = 0.30
    BAND_TEMPERATURE = 0.12
    MAX_BAND = 8
    MAX_REPLIES_PER_PARENT = 40

    def __init__(self, db_path: str = DB_PATH):
        self.retrieval = RetrievalBrain()
        self.markov = MarkovBrain()
        self.emojis = EmojiResolver()
        self._recent_raw: deque = deque(maxlen=20)
        self._recent_norm: deque = deque(maxlen=20)
        self._fallback_replies: List[str] = []
        self._load(db_path)

    def _load(self, db_path: str):
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT parentKey, reply FROM pairs WHERE parentKey != '' AND reply != ''")
        rows = [(p, r) for p, r in c.fetchall() if not is_junk(p) and not is_junk(r) and not is_blocked_reply(r)]
        keys = [p for p, _ in rows]
        replies = [r for _, r in rows]
        print(f"[brain] loading {len(keys)} pairs for retrieval…", file=sys.stderr)
        self.retrieval.train(keys, replies)
        print(f"[brain] {len(self.retrieval.parents)} unique parents.", file=sys.stderr)
        c.execute("SELECT content FROM messages WHERE content != ''")
        messages = [r[0] for r in c.fetchall() if not is_junk(r[0]) and not is_blocked_reply(r[0])]
        print(f"[brain] training markov on {len(messages)} messages…", file=sys.stderr)
        self.markov.train(messages)
        conn.close()
        # "I don't get it" style replies from the corpus, used only when retrieval has nothing
        seen = set()
        self._fallback_replies = []
        for r in replies:
            nr = normalize(r)
            if nr in seen:
                continue
            if looks_uncertain_reply(r) and 1 <= len(tokenize(r)) <= 8 and self._quality_ok(r):
                seen.add(nr)
                self._fallback_replies.append(r)
        print(f"[brain] {len(self._fallback_replies)} fallback replies. ready.\n", file=sys.stderr)

    def _parent_score(self, inp: str, parent: str, sim: float) -> float:
        score = sim * 3.0
        score += lexical_overlap(inp, parent) * 0.6
        cov = content_coverage(inp, parent)
        if cov is not None:
            score += cov * 0.9
            # the parent shares none of the input's actual content words -> char n-gram coincidence
            if cov == 0.0 and len(content_tokens(inp)) >= 2:
                score -= 0.6
        if is_question(inp) and is_question(parent):
            score += 0.2
        return score

    def _reply_score(self, inp: str, reply: str, reply_norm: str) -> float:
        score = 0.0
        # common replies are less interesting
        score -= math.log1p(self.retrieval.reply_freq[reply_norm]) * 0.45
        # heavily penalize repeats
        if reply_norm in self._recent_norm:
            score -= 2.0
        # small bonus for reply lexical relation, but avoid parroting
        reply_overlap = lexical_overlap(inp, reply)
        score += reply_overlap * 0.15
        if reply_overlap > 0.75:
            score -= 0.9
        if looks_generic(reply):
            score -= 0.7
        in_len = len(tokenize(inp))
        out_len = len(tokenize(reply))
        inp_is_q = is_question(inp)
        if inp_is_q and out_len <= 1:
            score -= 0.3
        # a real sentence deserves more than a one word grunt
        if in_len >= 3 and out_len <= 1:
            score -= 0.4
        if in_len >= 8 and out_len <= 2:
            score -= 0.3
        # short user input should not get essay replies
        if in_len <= 2 and out_len > 12:
            score -= 0.4
        # mild preference for actual sentences
        if 3 <= out_len <= 12:
            score += 0.2
        # giant lore dumps are rarely good
        if out_len >= 20:
            score -= 0.4
        return score

    def _candidates(self, text: str, context: Optional[List[str]] = None) -> List[Tuple[float, str, str]]:
        """Return (score, raw_reply, reply_norm) sorted best first, one entry per distinct reply."""
        best_by_reply: Dict[str, Tuple[float, str]] = {}
        for pi, sim in self.retrieval.top_parents(text, context=context, limit=25):
            parent = self.retrieval.parents[pi]
            ps = self._parent_score(text, parent, sim)
            replies = self.retrieval.replies[pi]
            if len(replies) > self.MAX_REPLIES_PER_PARENT:
                replies = random.sample(replies, self.MAX_REPLIES_PER_PARENT)
            for raw, nr in replies:
                s = ps + self._reply_score(text, raw, nr)
                prev = best_by_reply.get(nr)
                if prev is None or s > prev[0]:
                    best_by_reply[nr] = (s, raw)
        out = [(s, raw, nr) for nr, (s, raw) in best_by_reply.items()]
        out.sort(key=lambda x: x[0], reverse=True)
        return out

    def _pick_retrieval(self, text: str, context: Optional[List[str]] = None) -> Tuple[Optional[str], float]:
        cands = self._candidates(text, context=context)
        if not cands:
            return None, -999.0
        best = cands[0][0]
        if best < self.RETRIEVAL_FLOOR:
            return None, best
        # everything close to the best is an equally valid answer: sample instead of always taking #1
        band = [c for c in cands if c[0] >= best - self.BAND_WIDTH][:self.MAX_BAND]
        weights = [math.exp((c[0] - best) / self.BAND_TEMPERATURE) for c in band]
        choice = random.choices(band, weights=weights, k=1)[0]
        return choice[1], best

    def _mutate_reply(self, base_reply: str, user_text: str) -> str:
        user_len = len(tokenize(user_text))
        user_is_question = is_question(user_text)
        max_extra = 2 if user_len <= 3 else 5
        if random.random() < 0.60:
            continued = self.markov.continue_from(
                base_reply,
                extra_words=random.randint(1, max_extra),
            )
            if continued and normalize(continued) != normalize(base_reply) and self._quality_ok(continued):
                if lexical_overlap(base_reply, continued) >= 0.45:
                    if not user_is_question or lexical_overlap(user_text, continued) > 0:
                        return continued
        gen = self.markov.generate(
            seed=base_reply,
            max_words=max(5, len(tokenize(base_reply)) + max_extra),
        )
        if gen and lexical_overlap(base_reply, gen) >= 0.40 and self._quality_ok(gen):
            if not user_is_question or lexical_overlap(user_text, gen) > 0:
                return gen
        return base_reply

    def _quality_ok(self, text: str) -> bool:
        nt = normalize(text)
        toks = tokenize(nt)
        if not nt:
            return False
        if is_blocked_reply(nt) or is_junk(nt):
            return False
        if nt in self._recent_norm:
            return False
        if len(toks) < 1 or len(toks) > 18:
            return False
        counts = Counter(toks)
        if max(counts.values(), default=0) >= 3:
            return False
        if len(toks) >= 4 and len(set(toks)) / max(1, len(toks)) < 0.40:
            return False
        one_char = sum(1 for t in toks if len(t) == 1)
        if one_char >= max(3, len(toks) // 2):
            return False
        for i in range(len(toks) - 2):
            if toks[i] == toks[i + 1] == toks[i + 2]:
                return False
        return True

    def _fallback_reply(self, text: str) -> str:
        # 1) try to say something on-topic: markov chains seeded from the user's own words
        seeds = []
        toks = tokenize(text)
        if len(toks) >= 2:
            seeds.append(" ".join(toks[-2:]))
        seeds.extend(content_tokens(text))
        random.shuffle(seeds)
        for seed in seeds[:6]:
            gen = self.markov.generate(seed=seed, max_words=12)
            if 3 <= len(tokenize(gen)) <= 12 and self._quality_ok(gen):
                return gen
        # 2) honest confusion from the corpus ("huh", "idk man", ...)
        pool = [r for r in self._fallback_replies if normalize(r) not in self._recent_norm]
        if pool:
            return random.choice(pool)
        return "idk man"

    def reply(self, text: str, context: Optional[List[str]] = None) -> str:
        context = context or []
        hit, score = self._pick_retrieval(text, context=context)
        if hit is not None:
            candidate = hit
            # weak-ish hit: occasionally riff on it so the bot does not sound like a lookup table
            if score < 1.8 and random.random() < 0.20 and self._quality_ok(candidate):
                candidate = self._mutate_reply(candidate, text)
        else:
            candidate = self._fallback_reply(text)
        raw = self.emojis.resolve(candidate)
        self._recent_raw.append(raw)
        self._recent_norm.append(normalize(raw))
        return raw

    def serve(self):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
                if req.get("reload"):
                    self._load(DB_PATH)
                    print(json.dumps({"ok": True, "result": "reloaded"}), flush=True)
                    continue
                text = req.get("text", "") or ""
                context = req.get("context", []) or []
                if not isinstance(context, list):
                    context = []
                result = self.reply(text, context=context)
                print(json.dumps({"ok": True, "result": result}), flush=True)
            except Exception as e:
                print(json.dumps({"ok": False, "error": str(e)}), flush=True)

    def chat(self):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print("cute-ai - type something (ctrl+c to quit)\n")
        try:
            while True:
                user = input("you:  ").strip()
                if not user:
                    continue
                print(f"bot:  {self.reply(user)}\n")
        except (KeyboardInterrupt, EOFError):
            print("\nbye!")

if __name__ == "__main__":
    bot = Brain()
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        bot.serve()
    else:
        bot.chat()
