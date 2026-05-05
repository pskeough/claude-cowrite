#!/usr/bin/env python3
"""
split_chapters.py

Splits The Basilisk manuscript files into per-day chapter files.

Naming convention: day_00.txt, day_01.txt, day_02.txt ... day_50.txt
  - Pre-header content (epigraph, opening prose) -> day_prologue.txt
  - Day 0 (when labeled) -> day_00.txt
  - Day N -> day_NN.txt (zero-padded to 2 digits)

Cross-referencing: identical naming across all three version subdirectories
means day_18.txt in Original/ lines up with day_18.txt in 2025_AI_Edit/, etc.

Output structure:
  Chapters/
  ├── Original/
  │   ├── day_prologue.txt
  │   ├── day_01.txt
  │   └── ...
  ├── 2025_AI_Edit/
  │   ├── day_prologue.txt
  │   ├── day_00.txt
  │   └── ...
  └── 2026_Current_Edit/
      ├── day_prologue.txt
      ├── day_00.txt
      └── ...
"""

import re
import os

# -------------------------------------------------------------------
# Word-to-number map for written-out day names
# -------------------------------------------------------------------
WORD_TO_NUM = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
    'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19, 'twenty': 20,
}

# Matches ONLY a bare "Day X" header — nothing after the number/word.
# This deliberately excludes:
#   "Day 7 existed only as artifacts..."  (extra text)
#   "Day 21: Subject M. continues..."     (colon + text)
#   "Day One of Contact: ..."             (extra words)
_HEADER_RE = re.compile(
    r'^Day\s+(\w+)\s*$',
    re.IGNORECASE
)


def parse_day_number(line: str):
    """
    Return the integer day number if `line` is a standalone Day header,
    else return None.
    """
    m = _HEADER_RE.match(line.strip())
    if not m:
        return None
    token = m.group(1).lower()
    if token.isdigit():
        return int(token)
    return WORD_TO_NUM.get(token)  # None if unrecognized word


def split_manuscript(input_path: str, output_dir: str):
    """Read a manuscript file and write one .txt file per Day section."""
    print(f"\nProcessing: {os.path.basename(input_path)}")
    print(f"  Output  : {output_dir}")

    with open(input_path, 'r', encoding='utf-8-sig') as f:
        lines = f.readlines()

    # --- Pass 1: collect sections as (day_number | None, [lines]) ---
    sections = []          # final list
    current_day = None     # None = prologue
    current_lines = []

    for line in lines:
        day_num = parse_day_number(line)
        if day_num is not None:
            # Flush the current section
            sections.append((current_day, current_lines))
            current_day = day_num
            current_lines = [line]   # header line goes into the section
        else:
            current_lines.append(line)

    # Flush the last section
    sections.append((current_day, current_lines))

    # --- Pass 2: write files ---
    os.makedirs(output_dir, exist_ok=True)
    written = []

    for day_num, section_lines in sections:
        # Skip entirely blank sections
        if not any(l.strip() for l in section_lines):
            continue

        if day_num is None:
            filename = 'day_prologue.txt'
        else:
            filename = f'day_{day_num:02d}.txt'

        out_path = os.path.join(output_dir, filename)
        with open(out_path, 'w', encoding='utf-8') as f:
            # Strip leading blank lines from each section for cleanliness
            content = ''.join(section_lines).lstrip('\n')
            f.write(content)

        written.append(filename)
        print(f"    [OK] {filename}  ({len(section_lines)} source lines)")

    print(f"  -> {len(written)} files written.")
    return written


# -------------------------------------------------------------------
# Entry point
# -------------------------------------------------------------------
if __name__ == '__main__':
    # Resolve paths relative to this script's location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    raw_dir = os.path.join(
        project_root, 'BookFiles', 'RokosBasilisk', 'RawFiles'
    )
    chapters_dir = os.path.join(
        project_root, 'BookFiles', 'RokosBasilisk', 'Chapters'
    )

    manuscripts = [
        (
            os.path.join(raw_dir, 'The Basilisk.txt'),
            os.path.join(chapters_dir, 'Original'),
        ),
        (
            os.path.join(raw_dir, 'The Basilisk (2025 AI Edit).txt'),
            os.path.join(chapters_dir, '2025_AI_Edit'),
        ),
        (
            os.path.join(raw_dir, 'The Basilisk (2026 Current Edit).txt'),
            os.path.join(chapters_dir, '2026_Current_Edit'),
        ),
    ]

    print("=" * 60)
    print("The Basilisk — Chapter Splitter")
    print("=" * 60)

    for input_path, output_dir in manuscripts:
        if not os.path.exists(input_path):
            print(f"\n[SKIP] File not found: {input_path}")
            continue
        split_manuscript(input_path, output_dir)

    print("\n" + "=" * 60)
    print("Done.")
    print("=" * 60)
