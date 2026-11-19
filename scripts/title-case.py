#!/usr/bin/env python3
"""Applies Title Case to headings, titles, menu labels, buttons and table headers in the app's .tsx files.

Only plain literal text is changed (nothing containing { } or <). Sentences in paragraphs, hints and placeholders are left alone.
Usage: python3 scripts/title-case.py [--apply]
"""
import re, sys, pathlib

SMALL = {"a","an","the","and","but","or","nor","for","so","yet","as","at","by","in","of","on","per","to","via","vs","if"}

def keep(word: str) -> bool:
    # Already has a capital after the first letter (DPD, FD42102, WINJO, C&D, iPhone), contains a digit, a currency sign or a URL/path/email.
    core = re.sub(r"[^\w]", "", word)
    if not core: return True
    if re.match(r"&\w+;?", word): return True   # HTML entity such as &amp;
    if re.search(r"\d", word): return True
    if any(c.isupper() for c in word[1:]): return True
    if re.search(r"[£@/\\_]|https?:", word): return True
    return False

def cap(word: str) -> str:
    # capitalise the first alphabetic character, keep the rest as written
    for i, ch in enumerate(word):
        if ch.isalpha():
            return word[:i] + ch.upper() + word[i+1:]
    return word

def title_case(text: str) -> str:
    parts = re.split(r"(\s+)", text)
    words = [i for i, p in enumerate(parts) if p and not p.isspace()]
    out = list(parts)
    for n, i in enumerate(words):
        w = parts[i]
        first, last = n == 0, n == len(words) - 1
        if keep(w):
            continue
        # hyphenated words: capitalise each part
        segs = w.split("-")
        res = []
        for k, seg in enumerate(segs):
            bare = re.sub(r"[^\w']", "", seg).lower()
            if bare in SMALL and not (first and k == 0) and not (last and k == len(segs) - 1) and len(segs) == 1:
                res.append(seg)
            else:
                res.append(cap(seg))
        out[i] = "-".join(res)
    return "".join(out)

def plain(s: str) -> bool:
    return bool(s.strip()) and not re.search(r"[{}<>]|\$\{", s) and re.search(r"[A-Za-z]", s)

TAGS_TEXT = r"h1|h2|h3|h4|th|legend|summary|button|Button|SubmitButton|LinkButton"
def fix_text_children(src):
    changed = []
    def sub(m):
        text = m.group(3)
        if not plain(text): return m.group(0)
        new = title_case(text)
        if new != text: changed.append((text, new))
        return f"{m.group(1)}{m.group(2)}>{new}</{m.group(1)[1:]}>"
    # opening tag on one or more lines, literal text child, same closing tag
    pat = re.compile(rf"(<(?:{TAGS_TEXT}))((?:\s(?:[^<>]|=>)*?)?)>([^<>{{}}]+)</(?:{TAGS_TEXT})>", re.S)
    return pat.sub(sub, src), changed

def fix_props(src):
    changed = []
    def sub(m):
        text = m.group(2)
        if not plain(text): return m.group(0)
        new = title_case(text)
        if new != text: changed.append((text, new))
        return f'{m.group(1)}"{new}"'
    # title="…" props and title: "…" / label: "…" in nav/tab/metadata objects
    src = re.sub(r'(\b(?:title|pendingLabel)=)"([^"]+)"', sub, src)
    def sub_short(m):
        return m.group(0) if len(m.group(2).split()) > 5 else sub(m)
    src = re.sub(r'(\b(?:title|label): )"([^"]+)"', sub_short, src)
    return src, changed

def main():
    apply = "--apply" in sys.argv
    total = []
    for path in sorted(pathlib.Path("src").rglob("*.tsx")):
        s = path.read_text()
        s1, c1 = fix_text_children(s)
        s2, c2 = fix_props(s1)
        if c1 or c2:
            total += [(str(path), a, b) for a, b in c1 + c2]
            if apply: path.write_text(s2)
    seen = set()
    for p, a, b in total:
        key = (a, b)
        if key in seen: continue
        seen.add(key)
        print(f"{a!r:60} -> {b!r}", flush=True)
    print(f"\n{len(total)} changes in {len({p for p,_,_ in total})} files ({len(seen)} distinct)")

main()
