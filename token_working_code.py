# # import re
# # import string
# # from collections import defaultdict

# # class Tokenizer:
# #     def __init__(self):
# #         self.vocab_size = 10000
# #         self.min_frequency = 2
# #         self.vocab = {}  # token -> id
# #         self.merges = []  # list of (char1, char2) tuples
# #         self.special_tokens = {
# #             '<|endoftext|>': 100257,
# #             '<|padding|>': 100258,
# #             '<|startoftext|>': 100259,
# #             '<|unk|>': 100260,
# #             '<|mask|>': 100261
# #         }

# #     def _processclean(self, texts):
# #         print("cleaning text...")
# #         texts = re.sub(r'<.*?>', '', texts)
# #         texts = re.sub(r'https?://\S+|www\.\S+', '', texts)
# #         texts = texts.encode('ascii', 'ignore').decode()
# #         texts = texts.translate(str.maketrans('', '', string.punctuation))
# #         texts = re.sub(r'\d+', '', texts)
# #         texts = re.sub(r'\s+', ' ', texts).strip()
# #         texts = texts.lower()
# #         return texts

# #     def _get_pair_frequencies(self, corpus):
# #         pairs = defaultdict(int)
# #         for word in corpus:
# #             for i in range(len(word) - 1):
# #                 pairs[(word[i], word[i + 1])] += 1
# #         return pairs

# #     def _merge_pair(self, pair, corpus):
# #         new_corpus = []
# #         bigram = pair[0] + pair[1]
# #         for word in corpus:
# #             i = 0
# #             new_word = []
# #             while i < len(word):
# #                 if i < len(word) - 1 and (word[i], word[i + 1]) == pair:
# #                     new_word.append(bigram)
# #                     i += 2
# #                 else:
# #                     new_word.append(word[i])
# #                     i += 1
# #             new_corpus.append(new_word)
# #         return new_corpus

# #     def train(self, text):        
# #         cleaned = self._processclean(text)
# #         print("training tokenizer...")
# #         words = cleaned.split()
# #         corpus = [[char for char in word] + ['</w>'] for word in words]

# #         token_to_id = {}
# #         token_id = 0

# #         while len(token_to_id) < self.vocab_size:
# #             pair_freqs = self._get_pair_frequencies(corpus)
# #             if not pair_freqs:
# #                 break

# #             most_frequent = max(pair_freqs, key=pair_freqs.get)
# #             if pair_freqs[most_frequent] < self.min_frequency:
# #                 break

# #             self.merges.append(most_frequent)
# #             corpus = self._merge_pair(most_frequent, corpus)

# #             for word in corpus:
# #                 for token in word:
# #                     if token not in token_to_id:
# #                         token_to_id[token] = token_id
# #                         token_id += 1

# #         self.vocab = token_to_id
# #         # print(f"✅ Tokenizer trained vocab: {list(self.vocab.keys())[-10:]}")
# #         # print(f"✅ Tokenizer trained merges: {self.merges[-10:]}")
# #         # print(f"✅ Tokenizer trained with {len(self.vocab)} tokens")

# #         return self.merges , self.vocab

# #     def encode(self, text, add_special_tokens=True):        
# #         cleaned = self._processclean(text)
# #         print("encoding process...")
# #         words = cleaned.split()
# #         token_ids = []

# #         if add_special_tokens:
# #             token_ids.append(self.special_tokens['<|startoftext|>'])

# #         for word in words:
# #             symbols = [char for char in word] + ['</w>']
# #             merges_applied = True

# #             while merges_applied:
# #                 merges_applied = False
# #                 for pair in self.merges:
# #                     i = 0
# #                     while i < len(symbols) - 1:
# #                         if (symbols[i], symbols[i + 1]) == pair:
# #                             symbols[i:i + 2] = [pair[0] + pair[1]]
# #                             merges_applied = True
# #                             break
# #                         i += 1
# #                     if merges_applied:
# #                         break

# #             for symbol in symbols:
# #                 if symbol in self.vocab:
# #                     token_ids.append(self.vocab[symbol])
# #                 else:
# #                     token_ids.append(self.special_tokens['<|unk|>'])

# #         if add_special_tokens:
# #             token_ids.append(self.special_tokens['<|endoftext|>'])

# #         return token_ids

# #     def decode(self, token_ids):
# #         print("decoding process...")
# #         """Decode token IDs to text"""
# #         # Reverse vocab and special tokens
# #         id_to_token = {v: k for k, v in self.vocab.items()}
# #         id_to_token.update({v: k for k, v in self.special_tokens.items()})

# #         tokens = []
# #         for token_id in token_ids:
# #             token = id_to_token.get(token_id, '<|unk|>')
# #             if token not in ['<|startoftext|>', '<|endoftext|>', '<|padding|>', '<|unk|>', '<|mask|>']:
# #                 tokens.append(token)

# #         # Reconstruct text
# #         text = ''
# #         for token in tokens:
# #             tokentext = token.replace('</w>', '')
# #             if tokentext in '.,!?;:':
# #                 text = text.rstrip() + tokentext + ' '
# #             else:
# #                 text += tokentext + ' '

# #         return text.strip()


# import json
# import re
# import string
# import os
# from collections import defaultdict

# class Tokenizer:
#     def __init__(self):
#         self.vocab_size = 10000
#         self.min_frequency = 2
#         self.vocab = {}  # token -> id
#         self.merges = []  # list of (char1, char2) tuples
#         self.special_tokens = {
#             '<|endoftext|>': 100257,
#             '<|padding|>': 100258,
#             '<|startoftext|>': 100259,
#             '<|unk|>': 100260,
#             '<|mask|>': 100261
#         }

#     def _processclean(self, texts):
#         texts = re.sub(r'<.*?>', '', texts)
#         texts = re.sub(r'https?://\S+|www\.\S+', '', texts)
#         texts = texts.encode('ascii', 'ignore').decode()
#         texts = texts.translate(str.maketrans('', '', string.punctuation))
#         texts = re.sub(r'\d+', '', texts)
#         texts = re.sub(r'\s+', ' ', texts).strip()
#         texts = texts.lower()
#         return texts

#     def get_pair_frequencies(self, corpus):
#         pairs = defaultdict(int)
#         for word in corpus:
#             for i in range(len(word) - 1):
#                 pairs[(word[i], word[i + 1])] += 1
#         return pairs

#     def merge_pair(self, pair, corpus):
#         new_corpus = []
#         bigram = pair[0] + pair[1]
#         for word in corpus:
#             i = 0
#             new_word = []
#             while i < len(word):
#                 if i < len(word) - 1 and (word[i], word[i + 1]) == pair:
#                     new_word.append(bigram)
#                     i += 2
#                 else:
#                     new_word.append(word[i])
#                     i += 1
#             new_corpus.append(new_word)
#         return new_corpus

#     def train(self, text):
#         cleaned = self._processclean(text)
#         words = cleaned.split()
#         corpus = [[char for char in word] + ['</w>'] for word in words]

#         token_to_id = {}
#         token_id = 0

#         while len(token_to_id) < self.vocab_size:
#             pair_freqs = self.get_pair_frequencies(corpus)
#             if not pair_freqs:
#                 break

#             most_frequent = max(pair_freqs, key=pair_freqs.get)
#             if pair_freqs[most_frequent] < self.min_frequency:
#                 break

#             self.merges.append(most_frequent)
#             corpus = self.merge_pair(most_frequent, corpus)

#             for word in corpus:
#                 for token in word:
#                     if token not in token_to_id:
#                         token_to_id[token] = token_id
#                         token_id += 1

#         self.vocab = token_to_id

#     def encode(self, text, add_special_tokens=True):
#         cleaned = self._processclean(text)        
#         words = cleaned.split()        
#         token_ids = []

#         if add_special_tokens:
#             token_ids.append(self.special_tokens['<|startoftext|>'])

#         for word in words:
#             symbols = [char for char in word] + ['</w>']
#             # merges_applied = True            
#             # while merges_applied:
#             #     merges_applied = False
#             #     for pair in self.merges:
#             #         i = 0
#             #         while i < len(symbols) - 1:
#             #             if (symbols[i], symbols[i + 1]) == pair:
#             #                 symbols[i:i + 2] = [pair[0] + pair[1]]
#             #                 merges_applied = True
#             #                 break
#             #             i += 1
            
#             merges_applied = True
#             while merges_applied:
#                 merges_applied = False
#                 i = 0
#                 while i < len(symbols) - 1:
#                     pair = (symbols[i], symbols[i + 1])
#                     if pair in self.merges:
#                         symbols[i:i + 2] = [pair[0] + pair[1]]
#                         merges_applied = True
#                     else:
#                         i += 1
#                     if merges_applied:
#                         break
#             print(symbols)
#             for symbol in symbols:
#                 if symbol in self.vocab:
#                     token_ids.append(self.vocab[symbol])
#                 else:
#                     token_ids.append(self.special_tokens['<|unk|>'])

#         if add_special_tokens:
#             token_ids.append(self.special_tokens['<|endoftext|>'])

#         return token_ids

#     def decode(self, token_ids):
#         id_to_token = {v: k for k, v in self.vocab.items()}
#         id_to_token.update({v: k for k, v in self.special_tokens.items()})

#         tokens = []
#         for token_id in token_ids:
#             token = id_to_token.get(token_id, '<|unk|>')
#             if token not in self.special_tokens:
#                 tokens.append(token)

#         words = []
#         current_word = ''
#         for token in tokens:
#             tokentext = token.replace('</w>', '')
#             if tokentext == '</w>':
#                 words.append(current_word)
#                 current_word = ''
#             else:
#                 current_word += tokentext + ' '
#         if current_word:
#             words.append(current_word)

#         return ' '.join(words)

#     def save(self, vocab_path='data/output/vocab.json', merges_path='data/output/merges.json'):
#         os.makedirs(os.path.dirname(vocab_path), exist_ok=True)
#         os.makedirs(os.path.dirname(merges_path), exist_ok=True)
#         with open(vocab_path, 'w', encoding='utf-8') as f:
#             json.dump(self.vocab, f, ensure_ascii=False, indent=2)
#         with open(merges_path, 'w', encoding='utf-8') as f:
#             json.dump(self.merges, f, ensure_ascii=False, indent=2)

#     def load(self, vocab_path='data/output/vocab.json', merges_path='data/output/merges.json'):
#         os.makedirs(os.path.dirname(vocab_path), exist_ok=True)
#         os.makedirs(os.path.dirname(merges_path), exist_ok=True)
#         with open(vocab_path, 'r', encoding='utf-8') as f:
#             self.vocab = json.load(f)
#         with open(merges_path, 'r', encoding='utf-8') as f:
#             self.merges = [tuple(pair) for pair in json.load(f)]

# import json
# import re
# import string
# import os
# from collections import defaultdict

# class Tokenizer:
#     def __init__(self, vocab_size=10000, min_frequency=2, output_dir="data/output"):
#         self.vocab_size = vocab_size
#         self.min_frequency = min_frequency
#         self.output_dir = output_dir
#         self.vocab = {}  # token -> id
#         self.merges = {}  # (char1, char2) -> merged_token
#         self.inverse_merges = {}  # merged_token -> (char1, char2)
#         self.special_tokens = {
#             "<|endoftext|>": 100257,
#             "<|padding|>": 100258,
#             "<|startoftext|>": 100259,
#             "<|unk|>": 100260,
#             "<|mask|>": 100261
#         }
#         self.next_token_id = 0
#         os.makedirs(self.output_dir, exist_ok=True)

#     def _process_clean(self, texts):
#         """Clean and normalize text"""
#         texts = re.sub(r'<.*?>', '', texts)
#         texts = re.sub(r'https?://\S+|www\.\S+', '', texts)
#         texts = texts.encode('ascii', 'ignore').decode()
#         texts = texts.translate(str.maketrans('', '', string.punctuation))
#         texts = re.sub(r'\d+', '', texts)
#         texts = re.sub(r'\s+', ' ', texts).strip()
#         return texts

#     def _initialize_vocab(self, text):
#         """Initialize vocabulary with characters and special tokens"""
#         # Add special tokens first
#         for token, token_id in self.special_tokens.items():
#             self.vocab[token] = token_id
        
#         # Initialize with characters from text
#         chars = sorted(set(text))
#         self.next_token_id = max(self.special_tokens.values()) + 1
        
#         for char in chars:
#             if char not in self.vocab and char.strip():  # Skip whitespace characters as separate tokens
#                 self.vocab[char] = self.next_token_id
#                 self.next_token_id += 1

#     def _get_stats(self, words):
#         """Get frequency of adjacent pairs"""
#         pairs = defaultdict(int)
#         for word, freq in words:
#             symbols = word.split()
#             for i in range(len(symbols) - 1):
#                 pairs[(symbols[i], symbols[i + 1])] += freq
#         return pairs

#     def _merge_vocab(self, pair, words):
#         """Merge the most frequent pair in all words"""
#         first, second = pair
#         new_pair = first + second
#         new_words = []
        
#         for word, freq in words:
#             new_word = []
#             i = 0
#             while i < len(word):
#                 if i < len(word) - 1 and word[i] == first and word[i + 1] == second:
#                     new_word.append(new_pair)
#                     i += 2
#                 else:
#                     new_word.append(word[i])
#                     i += 1
#             new_words.append((new_word, freq))
        
#         return new_words

#     def train(self, text):
#         """Train the tokenizer on text"""
#         if not text:
#             print("No text provided for training.")
#             return

#         print("Cleaning text...")
#         cleaned = self._process_clean(text)
        
#         # Initialize vocabulary
#         self._initialize_vocab(cleaned)
        
#         # Pre-tokenize into words
#         words = cleaned.split()
        
#         word_freqs = defaultdict(int)
#         print(f"words freq: {word_freqs}")
#         for word in words:
#             word_freqs[' '.join(list(word)) + ' </w>'] += 1

#             vocab_words = [(list(k), v) for k, v in word_freqs.items()]
        
#         # vocab_words = [(key.split(), freq) for key, freq in word_freqs.items()]
        
#         print(f"Starting BPE training with {len(vocab_words)} unique words...")
        
#         # BPE training
#         merges_done = 0
#         while len(self.vocab) < self.vocab_size and merges_done < self.vocab_size - self.next_token_id:
#             pairs = self._get_stats(vocab_words)
#             if not pairs:
#                 break
                
#             best_pair = max(pairs, key=pairs.get)
#             best_freq = pairs[best_pair]
            
#             if best_freq < self.min_frequency:
#                 break
                
#             # Merge the best pair
#             vocab_words = self._merge_vocab(best_pair, vocab_words)
            
#             # Add to merges and vocabulary
#             merged_token = best_pair[0] + best_pair[1]
#             self.merges[best_pair] = merged_token
#             self.inverse_merges[merged_token] = best_pair
            
#             if merged_token not in self.vocab:
#                 self.vocab[merged_token] = self.next_token_id
#                 self.next_token_id += 1
            
#             merges_done += 1
            
#             if merges_done % 100 == 0:
#                 print(f"Merges done: {merges_done}, Vocabulary size: {len(self.vocab)}")
        
#         print(f"Training completed. Vocabulary size: {len(self.vocab)}, Merges: {len(self.merges)}")

#     def _tokenize_word(self, word):
#         """Tokenize a single word using learned merges"""
#         # Start with characters
#         tokens = list(word) + ['</w>']
        
#         # Apply merges until no more can be applied
#         changed = True
#         while changed and len(tokens) > 1:
#             changed = False
#             for i in range(len(tokens) - 1):
#                 pair = (tokens[i], tokens[i + 1])
#                 if pair in self.merges:
#                     tokens[i:i + 2] = [self.merges[pair]]
#                     changed = True
#                     break
        
#         return tokens

#     def encode(self, text, add_special_tokens=True):
#         """Encode text to token IDs"""
#         cleaned = self._process_clean(text)
#         words = cleaned.split()
#         token_ids = []

#         if add_special_tokens:
#             token_ids.append(self.special_tokens["<|startoftext|>"])

#         for word in words:
#             tokens = self._tokenize_word(word)
#             for token in tokens:
#                 if token in self.vocab:
#                     token_ids.append(self.vocab[token])
#                 else:
#                     # Try to handle unknown tokens by splitting into characters
#                     for char in token:
#                         if char in self.vocab:
#                             token_ids.append(self.vocab[char])
#                         else:
#                             token_ids.append(self.special_tokens["<|unk|>"])

#         if add_special_tokens:
#             token_ids.append(self.special_tokens["<|endoftext|>"])

#         return token_ids

#     def decode(self, token_ids):
#         """Decode token IDs back to text"""
#         id_to_token = {v: k for k, v in self.vocab.items()}
#         id_to_token.update(self.special_tokens)
        
#         tokens = []
#         for token_id in token_ids:
#             if token_id in id_to_token:
#                 tokens.append(id_to_token[token_id])
#             else:
#                 tokens.append("<|unk|>")
        
#         # Reconstruct text
#         text = ""
#         for token in tokens:
#             if token == "<|startoftext|>":
#                 continue
#             elif token == "<|endoftext|>":
#                 break
#             elif token == "</w>":
#                 text += " "
#             elif token in self.special_tokens.values():
#                 continue
#             else:
#                 text += token
        
#         return text.strip()

#     def save(self):
#         """Save vocabulary and merges"""
#         vocab_path = os.path.join(self.output_dir, "vocab.json")
#         merges_path = os.path.join(self.output_dir, "merges.json")
        
#         with open(vocab_path, "w", encoding="utf-8") as f:
#             json.dump(self.vocab, f, indent=2, ensure_ascii=False)
        
#         with open(merges_path, "w", encoding="utf-8") as f:
#             # Convert tuples to lists for JSON serialization
#             merges_list = [list(pair) for pair in self.merges.keys()]
#             json.dump(merges_list, f, indent=2, ensure_ascii=False)
        
#         print(f"Model saved to {self.output_dir}")

#     def load(self):
#         """Load vocabulary and merges"""
#         vocab_path = os.path.join(self.output_dir, "vocab.json")
#         merges_path = os.path.join(self.output_dir, "merges.json")
        
#         try:
#             with open(vocab_path, "r", encoding="utf-8") as f:
#                 self.vocab = json.load(f)
            
#             with open(merges_path, "r", encoding="utf-8") as f:
#                 merges_list = json.load(f)
#                 self.merges = {}
#                 self.inverse_merges = {}
#                 for pair in merges_list:
#                     merged = pair[0] + pair[1]
#                     self.merges[tuple(pair)] = merged
#                     self.inverse_merges[merged] = tuple(pair)
            
#             print(f"Model loaded from {self.output_dir}")
#             return True
#         except FileNotFoundError:
#             print("Model files not found. Please train the tokenizer first.")
#             return False


import json
import os
import re
from collections import defaultdict
from pathlib import Path

class Tokenizer:
    END_WORD = "</w>"

    def __init__(self, vocab_size=1000000, min_frequency=2, output_dir="data/output"):
        self.vocab_size = int(vocab_size)
        self.min_frequency = int(min_frequency)
        self.output_dir = output_dir

        # token -> id
        self.vocab = {}
        # ordered merges and ranks
        self.merges = []                # list of tuples: [(a,b), ...] in learned order
        self.pair_ranks = {}            # {(a,b): rank}

        # Special tokens (literal, NOT HTML-escaped)
        self.special_tokens = {
            "<|endoftext|>": 2,
            "<|padding|>":   2,
            "<|startoftext|>": 1,
            "<|unk|>":       4,
            "<|mask|>":      5,
        }

        self.next_token_id = max(self.special_tokens.values()) + 1
        Path(self.output_dir).mkdir(parents=True, exist_ok=True)

    # -------------------- Cleaning --------------------

    def _process_clean(self, text: str) -> str:
        """Minimal, safe cleaning: remove URLs + normalize whitespace. Keep Unicode and <...>."""
        if not isinstance(text, str):
            return ""
        text = re.sub(r"https?://\S+|www\.\S+", "", text)
        text = re.sub(r'\d+', '', text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    # -------------------- Vocab init --------------------

    def _initialize_vocab(self, text: str):
        """Initialize vocabulary with chars in text + special tokens + END_WORD marker."""
        # Special tokens
        for tok, tid in self.special_tokens.items():
            self.vocab[tok] = tid

        # Ensure END_WORD is present
        if self.END_WORD not in self.vocab:
            self.vocab[self.END_WORD] = self.next_token_id
            self.next_token_id += 1

        # Characters from corpus
        for ch in sorted(set(text)):
            if ch.strip() and ch not in self.vocab:
                self.vocab[ch] = self.next_token_id
                self.next_token_id += 1

    # -------------------- BPE helpers --------------------

    @staticmethod
    def _get_stats(words):
        """
        Count frequency of adjacent symbol pairs across all words.
        words: list of (symbols_list, freq); symbols_list excludes spaces and ends with </w>.
        """
        pairs = defaultdict(int)
        for symbols, freq in words:
            for i in range(len(symbols) - 1):
                a, b = symbols[i], symbols[i + 1]
                if a == Tokenizer.END_WORD or b == Tokenizer.END_WORD:
                    continue  # don't merge across word boundary
                pairs[(a, b)] += freq
        return pairs

    @staticmethod
    def _merge_vocab(pair, words):
        """
        Merge a pair across all words. Returns (new_words, merged_symbol)
        words is list of (symbols_list, freq), symbols_list is mutated logically (not in place).
        """
        a, b = pair
        merged = a + b
        new_words = []
        for symbols, freq in words:
            i = 0
            out = []
            while i < len(symbols):
                if i < len(symbols) - 1 and symbols[i] == a and symbols[i + 1] == b:
                    out.append(merged)
                    i += 2
                else:
                    out.append(symbols[i])
                    i += 1
            new_words.append((out, freq))
        return new_words, merged

    # -------------------- Train --------------------

    def train(self, text: str):
        if not text:
            print("❌ No text provided for training.")
            return

        print("🧹 Cleaning text...")
        cleaned = self._process_clean(text)
        if not cleaned:
            print("❌ Text empty after cleaning.")
            return

        print("🔤 Initializing vocabulary...")
        self._initialize_vocab(cleaned)

        # Build word frequencies as lists of symbols + END_WORD
        word_freqs = defaultdict(int)
        for word in cleaned.split():
            symbols = list(word) + [self.END_WORD]
            word_freqs[tuple(symbols)] += 1  # tuple for dict key stability

        vocab_words = [(list(sym_tuple), freq) for sym_tuple, freq in word_freqs.items()]

        print(f"🚀 Starting BPE training with {len(vocab_words)} unique words...")

        merges_done = 0
        while len(self.vocab) < self.vocab_size:
            pairs = self._get_stats(vocab_words)
            if not pairs:
                print("⚠️  No more pairs to merge.")
                break

            (best_pair, best_freq) = max(pairs.items(), key=lambda x: x[1])
            if best_freq < self.min_frequency:
                print(f"⚠️  No pairs meet min_frequency={self.min_frequency}.")
                break

            vocab_words, merged_token = self._merge_vocab(best_pair, vocab_words)

            if merged_token not in self.vocab:
                self.vocab[merged_token] = self.next_token_id
                self.next_token_id += 1

            # Record merge **in order** and rank
            self.merges.append(best_pair)
            self.pair_ranks[best_pair] = len(self.merges) - 1
            merges_done += 1

            if merges_done % 100 == 0:
                print(f"🧩 Merges: {merges_done}, Vocab size: {len(self.vocab)}")

        print(f"✅ Training completed. Vocabulary size: {len(self.vocab)}, merges: {len(self.merges)}")

    # -------------------- Tokenize word --------------------

    def _tokenize_word(self, word: str):
        """Apply merges by rank until no more can be applied."""
        tokens = list(word) + [self.END_WORD]
        if not self.merges:
            return tokens

        while True:
            pairs = [(tokens[i], tokens[i + 1]) for i in range(len(tokens) - 1)]
            ranked = [(self.pair_ranks[p], i, p) for i, p in enumerate(pairs) if p in self.pair_ranks]
            if not ranked:
                break
            _, pos, pair = min(ranked, key=lambda x: x[0])
            a, b = pair
            merged = a + b
            tokens = tokens[:pos] + [merged] + tokens[pos + 2:]
        return tokens

    # -------------------- Encode / Decode --------------------

    def encode(self, text: str, add_special_tokens: bool = True):
        cleaned = self._process_clean(text)
        if not cleaned:
            return []

        token_ids = []
        if add_special_tokens:
            token_ids.append(self.special_tokens["<|startoftext|>"])

        for word in cleaned.split():
            for tok in self._tokenize_word(word):
                if tok in self.vocab:
                    token_ids.append(self.vocab[tok])
                else:
                    # fallback to characters
                    for ch in tok:
                        token_ids.append(self.vocab.get(ch, self.special_tokens["<|unk|>"]))

        if add_special_tokens:
            token_ids.append(self.special_tokens["<|endoftext|>"])
        return token_ids

    def decode(self, token_ids):
        # Build id->token map including specials
        id_to_token = {tid: tok for tok, tid in self.vocab.items()}
        for tok, tid in self.special_tokens.items():
            id_to_token[tid] = tok

        out = []
        for tid in token_ids:
            tok = id_to_token.get(tid, "<|unk|>")
            if tok in ("<|startoftext|>", "<|padding|>", "<|mask|>"):
                continue
            if tok == "<|endoftext|>":
                break
            if tok == self.END_WORD:
                out.append(" ")
            elif tok.startswith("<|") and tok.endswith("|>"):
                # Ignore other specials in surface
                continue
            else:
                out.append(tok)
        return "".join(out).strip()

    # -------------------- Save / Load --------------------

    def save(self):
        vocab_path = os.path.join(self.output_dir, "vocab.json")
        merges_path = os.path.join(self.output_dir, "merges.json")
        with open(vocab_path, "w", encoding="utf-8") as f:
            json.dump(self.vocab, f, ensure_ascii=False, indent=2)
        with open(merges_path, "w", encoding="utf-8") as f:
            json.dump([[a, b] for (a, b) in self.merges], f, ensure_ascii=False, indent=2)
        print(f"💾 Model saved to {self.output_dir}")

    def load(self):
        vocab_path = os.path.join(self.output_dir, "vocab.json")
        merges_path = os.path.join(self.output_dir, "merges.json")
        try:
            with open(vocab_path, "r", encoding="utf-8") as f:
                self.vocab = {k: int(v) for k, v in json.load(f).items()}
            with open(merges_path, "r", encoding="utf-8") as f:
                merges_list = json.load(f)  # [[a,b], ...]
            self.merges = [tuple(p) for p in merges_list]
            self.pair_ranks = {tuple(p): i for i, p in enumerate(self.merges)}

            # recompute next_token_id safely
            self.next_token_id = max(self.vocab.values()) + 1

            print(f"✅ Model loaded from {self.output_dir}")
            return True
        except FileNotFoundError:
            print("❌ Model files not found. Please train the tokenizer first.")
            return False
