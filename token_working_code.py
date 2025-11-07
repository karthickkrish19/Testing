import os
import json
from collections import defaultdict

class Tokenizer:
    def __init__(self, output_dir="data/output", vocab_size=30000, use_byte_level=False):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)
        self.vocab_size = vocab_size
        self.use_byte_level = use_byte_level
        self.special_tokens = ["<unk>", "<pad>", "<bos>", "<eos>"]
        self.vocab = {}         # token → id
        self.id_to_token = {}   # id → token
        self.bpe_merges = []    # list of merges (tuple)
        self.bpe_ranks = {}     # merge pair → rank

    def _initial_tokens(self, word: str):
        if self.use_byte_level:
            return [chr(b) for b in word.encode('utf-8')] + ['</w>']
        else:
            return list(word) + ['</w>']

    def _get_pair_frequencies(self, corpus):
        pairs = defaultdict(int)
        for word in corpus:
            for i in range(len(word) - 1):
                pairs[(word[i], word[i + 1])] += 1
        return pairs

    def _merge_pair(self, pair, corpus):
        new_corpus = []
        bigram = ''.join(pair)
        for word in corpus:
            new_word = []
            i = 0
            while i < len(word):
                if i < len(word) - 1 and (word[i], word[i + 1]) == pair:
                    new_word.append(bigram)
                    i += 2
                else:
                    new_word.append(word[i])
                    i += 1
            new_corpus.append(new_word)
        return new_corpus

    def train(self, token_lists):
        merges = []
        token_set = set()
        corpus = token_lists

        while len(token_set) < self.vocab_size:
            pair_freqs = self._get_pair_frequencies(corpus)
            if not pair_freqs:
                break
            most_freq = max(pair_freqs, key=pair_freqs.get)
            merges.append(most_freq)
            corpus = self._merge_pair(most_freq, corpus)
            for word in corpus:
                token_set.update(word)
            if len(token_set) >= self.vocab_size:
                break

        self.bpe_merges = merges
        full_vocab = self.special_tokens + sorted(token_set)
        self.vocab = {tok: idx for idx, tok in enumerate(full_vocab)}
        self.id_to_token = {idx: tok for tok, idx in self.vocab.items()}
        self.bpe_ranks = {merge: i for i, merge in enumerate(self.bpe_merges)}
        return merges, token_set

    def save(self):
        with open(os.path.join(self.output_dir, "vocab.json"), 'w', encoding='utf-8') as f:
            json.dump(self.vocab, f, indent=2)
        with open(os.path.join(self.output_dir, "merges.txt"), 'w', encoding='utf-8') as f:
            f.write("#version:0.2\n")
            for a, b in self.bpe_merges:
                f.write(f"{a} {b}\n")

    def load(self):
        with open(os.path.join(self.output_dir, "vocab.json"), 'r', encoding='utf-8') as f:
            self.vocab = json.load(f)
        self.id_to_token = {int(idx): tok for tok, idx in self.vocab.items()}
        with open(os.path.join(self.output_dir, "merges.txt"), 'r', encoding='utf-8') as f:
            lines = f.read().splitlines()[1:]
        self.bpe_merges = [tuple(line.split()) for line in lines]
        self.bpe_ranks = {merge: i for i, merge in enumerate(self.bpe_merges)}

    def _apply_merges(self, tokens):
        while True:
            pairs = [(tokens[i], tokens[i + 1]) for i in range(len(tokens) - 1)]
            if not pairs:
                break
            ranked = [(pair, self.bpe_ranks.get(pair, float('inf'))) for pair in pairs]
            if all(rank == float('inf') for _, rank in ranked):
                break
            best_pair, _ = min(ranked, key=lambda x: x[1])
            new_tokens = []
            i = 0
            while i < len(tokens):
                if i < len(tokens) - 1 and (tokens[i], tokens[i + 1]) == best_pair:
                    new_tokens.append(tokens[i] + tokens[i + 1])
                    i += 2
                else:
                    new_tokens.append(tokens[i])
                    i += 1
            tokens = new_tokens
        return tokens

    def encode(self, text: str):
        token_ids = []
        unknown = []
        for word in text.strip().split():
            tokens = self._initial_tokens(word)
            subtoks = self._apply_merges(tokens)
            word_unknown = False
            for tok in subtoks:
                if tok in self.vocab:
                    token_ids.append(self.vocab[tok])
                else:
                    word_unknown = True
                    token_ids.append(self.vocab.get("<unk>", 0))
            if word_unknown:
                unknown.append(word)
        return token_ids, unknown

    def decode(self, token_ids):
        tokens = [self.id_to_token.get(tid, "<unk>") for tid in token_ids]
        words = []
        cur = ""
        for tok in tokens:
            if tok.endswith('</w>'):
                cur += tok[:-len('</w>')]
                words.append(cur)
                cur = ""
            elif tok == "<eos>":
                break
            else:
                cur += tok
        if cur:
            words.append(cur)
            
        return " ".join(words)
