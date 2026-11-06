// Prism syntax highlighting for code blocks (text content stays identical to the model's plain text).
// Covers the supported code languages; components are
// imported in dependency order.
import Prism from 'prismjs';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-arduino';
import 'prismjs/components/prism-objectivec';
import 'prismjs/components/prism-glsl';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-less';
import 'prismjs/components/prism-sass';
import 'prismjs/components/prism-coffeescript';
import 'prismjs/components/prism-flow';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-purescript';
import 'prismjs/components/prism-idris';
import 'prismjs/components/prism-reason';
import 'prismjs/components/prism-scheme';
import 'prismjs/components/prism-racket';
import 'prismjs/components/prism-basic';
import 'prismjs/components/prism-vbnet';
import 'prismjs/components/prism-visual-basic';
import 'prismjs/components/prism-fsharp';
import 'prismjs/components/prism-groovy';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-scala';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-protobuf';
import 'prismjs/components/prism-solidity';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-abap';
import 'prismjs/components/prism-agda';
import 'prismjs/components/prism-nasm';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-bnf';
import 'prismjs/components/prism-ebnf';
import 'prismjs/components/prism-clojure';
import 'prismjs/components/prism-dhall';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-elm';
import 'prismjs/components/prism-erlang';
import 'prismjs/components/prism-fortran';
import 'prismjs/components/prism-gherkin';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-hcl';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-julia';
import 'prismjs/components/prism-latex';
import 'prismjs/components/prism-lisp';
import 'prismjs/components/prism-livescript';
import 'prismjs/components/prism-llvm';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-wolfram';
import 'prismjs/components/prism-matlab';
import 'prismjs/components/prism-mermaid';
import 'prismjs/components/prism-nix';
import 'prismjs/components/prism-ocaml';
import 'prismjs/components/prism-pascal';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-prolog';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-coq';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-smalltalk';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-verilog';
import 'prismjs/components/prism-vhdl';
import 'prismjs/components/prism-wasm';
import 'prismjs/components/prism-yaml';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';

/** Language label to Prism grammar id (empty string means plain text). */
const GRAMMAR: Record<string, string> = {
  'abap': 'abap', 'agda': 'agda', 'arduino': 'arduino', 'ascii art': '', 'assembly': 'nasm', 'bash': 'bash', 'basic': 'basic', 'bnf': 'bnf',
  'c': 'c', 'c#': 'csharp', 'c++': 'cpp', 'clojure': 'clojure', 'coffeescript': 'coffeescript', 'css': 'css', 'dart': 'dart', 'dhall': 'dhall',
  'diff': 'diff', 'docker': 'docker', 'ebnf': 'ebnf', 'elixir': 'elixir', 'elm': 'elm', 'erlang': 'erlang', 'f#': 'fsharp', 'flow': 'flow',
  'fortran': 'fortran', 'gherkin': 'gherkin', 'glsl': 'glsl', 'go': 'go', 'graphql': 'graphql', 'groovy': 'groovy', 'haskell': 'haskell',
  'hcl': 'hcl', 'html': 'markup', 'idris': 'idris', 'java': 'java', 'javascript': 'javascript', 'json': 'json', 'julia': 'julia',
  'kotlin': 'kotlin', 'latex': 'latex', 'less': 'less', 'lisp': 'lisp', 'livescript': 'livescript', 'llvm ir': 'llvm', 'lua': 'lua',
  'makefile': 'makefile', 'markdown': 'markdown', 'markup': 'markup', 'mathematica': 'wolfram', 'matlab': 'matlab', 'mermaid': 'mermaid',
  'nix': 'nix', 'litpage formula': 'javascript', 'objective-c': 'objectivec', 'ocaml': 'ocaml', 'pascal': 'pascal', 'perl': 'perl', 'php': 'php',
  'plain text': '', 'powershell': 'powershell', 'prolog': 'prolog', 'protobuf': 'protobuf', 'purescript': 'purescript', 'python': 'python',
  'r': 'r', 'racket': 'racket', 'reason': 'reason', 'rocq': 'coq', 'coq': 'coq', 'ruby': 'ruby', 'rust': 'rust', 'sass': 'sass', 'scala': 'scala',
  'scheme': 'scheme', 'scss': 'scss', 'shell': 'bash', 'smalltalk': 'smalltalk', 'solidity': 'solidity', 'sql': 'sql', 'swift': 'swift',
  'toml': 'toml', 'typescript': 'typescript', 'vb.net': 'vbnet', 'verilog': 'verilog', 'vhdl': 'vhdl', 'visual basic': 'visual-basic',
  'webassembly': 'wasm', 'xml': 'markup', 'yaml': 'yaml',
  // legacy labels for older blocks
  '(e)bnf': 'ebnf', 'java/c/c++/c#': 'clike', 'jsx': 'jsx', 'tsx': 'tsx',
};

export function grammarFor(language: string): string {
  return GRAMMAR[language.toLowerCase()] ?? language.toLowerCase();
}

export function highlightCode(el: HTMLElement, value: RichText, language: string) {
  const text = toPlainText(value);
  const lang = grammarFor(language);
  const grammar = lang ? Prism.languages[lang] : undefined;
  if (!grammar || !text) {
    el.textContent = text;
    if (!text) el.replaceChildren();
    return;
  }
  el.innerHTML = Prism.highlight(text, grammar, lang);
}

export function highlightToHtml(text: string, language: string): string {
  const lang = grammarFor(language);
  const grammar = lang ? Prism.languages[lang] : undefined;
  if (!grammar) return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return Prism.highlight(text, grammar, lang);
}
