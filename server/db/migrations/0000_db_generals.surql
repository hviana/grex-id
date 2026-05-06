DEFINE ANALYZER general_analyzer_fts
  TOKENIZERS class
  FILTERS lowercase, ascii, ngram(3, 32);