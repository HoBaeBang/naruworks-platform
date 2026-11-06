// Formula function reference shown in the formula editor.
export interface FormulaDocExample { input: string; output: string | null }
export interface FormulaFunctionDoc { name: string; syntax: string[]; description: string; examples: FormulaDocExample[] }
export interface FormulaBuiltinDoc { symbol: string; type: string; description: string; examples: FormulaDocExample[] }

export const FUNCTION_DOCS: Record<string, FormulaFunctionDoc> = {
 "if": {
  "name": "if",
  "syntax": [
   "if(condition, ifTrue, ifFalse)",
   "condition.if(ifTrue, ifFalse)"
  ],
  "description": "Chooses one value when the condition is true and the other when it is false.",
  "examples": [
   {
    "input": "if(true, 1, 2)",
    "output": "1"
   },
   {
    "input": "if(false, 1, 2)",
    "output": "2"
   },
   {
    "input": "prop(\"Checked\") == true ? \"Complete\" : \"Incomplete\"",
    "output": null
   },
   {
    "input": "true.if(1, 2)",
    "output": "1"
   },
   {
    "input": "false.if(1, 2)",
    "output": "2"
   }
  ]
 },
 "ifs": {
  "name": "ifs",
  "syntax": [
   "ifs(condition, ifTrue, condition2, ifTrue2, ..., else)",
   "condition.ifs(ifTrue, condition2, ifTrue2, ..., else)"
  ],
  "description": "Checks conditions in order and yields the value for the first match, with a final fallback.",
  "examples": [
   {
    "input": "ifs(true, 1, true, 2, 3)",
    "output": "1"
   },
   {
    "input": "ifs(false, 1, false, 2, 3)",
    "output": "3"
   },
   {
    "input": "true.ifs(1, true, 2, 3)",
    "output": "1"
   },
   {
    "input": "false.ifs(1, false, 2, 3)",
    "output": "3"
   }
  ]
 },
 "and": {
  "name": "and",
  "syntax": [
   "and(boolean, boolean, ...)",
   "boolean.and(boolean, ...)"
  ],
  "description": "Checks that every supplied condition is true.",
  "examples": [
   {
    "input": "and(true, true, true)",
    "output": "true"
   },
   {
    "input": "and(3 > 2, 2 < 3)",
    "output": "false"
   },
   {
    "input": "true.and(true, true)",
    "output": "true"
   },
   {
    "input": "(3 > 2).and(2 < 3)",
    "output": "false"
   }
  ]
 },
 "or": {
  "name": "or",
  "syntax": [
   "or(boolean, boolean, ...)",
   "boolean.or(boolean, ...)"
  ],
  "description": "Checks whether at least one supplied condition is true.",
  "examples": [
   {
    "input": "or(true, false, false)",
    "output": "true"
   },
   {
    "input": "or(3 > 2, 2 < 3)",
    "output": "true"
   },
   {
    "input": "true.or(false, false)",
    "output": "true"
   },
   {
    "input": "(3 > 2).or(2 < 3)",
    "output": "true"
   }
  ]
 },
 "not": {
  "name": "not",
  "syntax": [
   "not(boolean)",
   "boolean.not()"
  ],
  "description": "Flips a boolean result.",
  "examples": [
   {
    "input": "not(true)",
    "output": "false"
   },
   {
    "input": "not(2 > 3)",
    "output": "true"
   },
   {
    "input": "true.not()",
    "output": "false"
   },
   {
    "input": "(2 > 3).not()",
    "output": "true"
   }
  ]
 },
 "empty": {
  "name": "empty",
  "syntax": [
   "empty(value?)",
   "value.empty()"
  ],
  "description": "Tests whether a value has no content. With no argument, it produces an empty value.",
  "examples": [
   {
    "input": "empty()",
    "output": null
   },
   {
    "input": "empty(0)",
    "output": "true"
   },
   {
    "input": "empty([])",
    "output": "true"
   },
   {
    "input": "0.empty()",
    "output": "true"
   },
   {
    "input": "[].empty()",
    "output": "true"
   }
  ]
 },
 "length": {
  "name": "length",
  "syntax": [
   "length(value)",
   "value.length()"
  ],
  "description": "Counts characters in text or items in a list.",
  "examples": [
   {
    "input": "length(\"hello\")",
    "output": "5"
   },
   {
    "input": "length([1, 2, 3])",
    "output": "3"
   },
   {
    "input": "\"hello\".length()",
    "output": "5"
   },
   {
    "input": "[1, 2, 3].length()",
    "output": "3"
   }
  ]
 },
 "substring": {
  "name": "substring",
  "syntax": [
   "substring(text, startIndex, endIndex?)",
   "text.substring(startIndex, endIndex?)"
  ],
  "description": "Takes the portion of text between the start index and optional end index.",
  "examples": [
   {
    "input": "substring(\"Orbit\", 0, 3)",
    "output": "\"Orb\""
   },
   {
    "input": "substring(\"Orbit\", 3)",
    "output": "\"it\""
   },
   {
    "input": "\"Orbit\".substring(0, 3)",
    "output": "\"Orb\""
   },
   {
    "input": "\"Orbit\".substring(3)",
    "output": "\"it\""
   }
  ]
 },
 "contains": {
  "name": "contains",
  "syntax": [
   "contains(value, search)",
   "value.contains(search)"
  ],
  "description": "Checks whether a value includes the search text.",
  "examples": [
   {
    "input": "contains(\"Orbit\", \"bit\")",
    "output": "true"
   },
   {
    "input": "\"Orbit\".contains(\"bit\")",
    "output": "true"
   }
  ]
 },
 "test": {
  "name": "test",
  "syntax": [
   "test(text, pattern)",
   "text.test(pattern)"
  ],
  "description": "Tests text against a regular expression.",
  "examples": [
   {
    "input": "test(\"Orbit\", \"^Orb\")",
    "output": "true"
   },
   {
    "input": "test(\"Orbit\", \"\\d\")",
    "output": "false"
   },
   {
    "input": "\"Orbit\".test(\"^Orb\")",
    "output": "true"
   },
   {
    "input": "\"Orbit\".test(\"\\d\")",
    "output": "false"
   }
  ]
 },
 "match": {
  "name": "match",
  "syntax": [
   "match(text, pattern)",
   "text.match(pattern)"
  ],
  "description": "Collects every regular-expression match into a list.",
  "examples": [
   {
    "input": "match(\"Orbit Orbit\", \"Orb\")",
    "output": "[\"Orb\", \"Orb\"]"
   },
   {
    "input": "match(\"Orbit 123 Orbit 456\", \"\\d+\")",
    "output": "[\"123\", \"456\"]"
   },
   {
    "input": "\"Orbit Orbit\".match(\"Orb\")",
    "output": "[\"Orb\", \"Orb\"]"
   },
   {
    "input": "\"Orbit 123 Orbit 456\".match(\"\\d+\")",
    "output": "[\"123\", \"456\"]"
   }
  ]
 },
 "replace": {
  "name": "replace",
  "syntax": [
   "replace(text, pattern, replacement?)",
   "text.replace(pattern, replacement?)"
  ],
  "description": "Changes the first regular-expression match to replacement text.",
  "examples": [
   {
    "input": "replace(\"Orbit Orbit\", \"O\", \"Arc\")",
    "output": "\"Arcrbit Orbit\""
   },
   {
    "input": "\"Orbit Orbit\".replace(\"O\", \"Arc\")",
    "output": "\"Arcrbit Orbit\""
   }
  ]
 },
 "replaceAll": {
  "name": "replaceAll",
  "syntax": [
   "replaceAll(text, pattern, replacement?)",
   "text.replaceAll(pattern, replacement?)"
  ],
  "description": "Changes every regular-expression match to replacement text.",
  "examples": [
   {
    "input": "replaceAll(\"Orbit Orbit\", \"O\", \"Arc\")",
    "output": "\"Arcrbit Arcrbit\""
   },
   {
    "input": "replaceAll(\"Orbit 123\", \"\\d\", \"\")",
    "output": "\"Orbit\""
   },
   {
    "input": "\"Orbit Orbit\".replaceAll(\"O\", \"Arc\")",
    "output": "\"Arcrbit Arcrbit\""
   },
   {
    "input": "\"Orbit 123\".replaceAll(\"\\d\", \"\")",
    "output": "\"Orbit\""
   }
  ]
 },
 "lower": {
  "name": "lower",
  "syntax": [
   "lower(text)",
   "text.lower()"
  ],
  "description": "Changes text to lowercase.",
  "examples": [
   {
    "input": "lower(\"MOSAIC\")",
    "output": "\"mosaic\""
   },
   {
    "input": "\"MOSAIC\".lower()",
    "output": "\"mosaic\""
   }
  ]
 },
 "upper": {
  "name": "upper",
  "syntax": [
   "upper(text)",
   "text.upper()"
  ],
  "description": "Changes text to uppercase.",
  "examples": [
   {
    "input": "upper(\"mosaic\")",
    "output": "\"MOSAIC\""
   },
   {
    "input": "\"mosaic\".upper()",
    "output": "\"MOSAIC\""
   }
  ]
 },
 "trim": {
  "name": "trim",
  "syntax": [
   "trim(text)",
   "text.trim()"
  ],
  "description": "Drops whitespace at both ends of text.",
  "examples": [
   {
    "input": "trim(\"  mosaic  \")",
    "output": "\"mosaic\""
   },
   {
    "input": "\"  mosaic  \".trim()",
    "output": "\"mosaic\""
   }
  ]
 },
 "repeat": {
  "name": "repeat",
  "syntax": [
   "repeat(text, count)",
   "text.repeat(count)"
  ],
  "description": "Copies text the requested number of times.",
  "examples": [
   {
    "input": "repeat(\"0\", 4)",
    "output": "\"0000\""
   },
   {
    "input": "repeat(\"~=\", 10).style(\"blue\")",
    "output": null
   },
   {
    "input": "\"0\".repeat(4)",
    "output": "\"0000\""
   },
   {
    "input": "\"~=\".repeat(10).style(\"blue\")",
    "output": null
   }
  ]
 },
 "padStart": {
  "name": "padStart",
  "syntax": [
   "padStart(text, targetLength, padString)",
   "text.padStart(targetLength, padString)"
  ],
  "description": "Adds padding before text until it reaches the requested length.",
  "examples": [
   {
    "input": "padStart(\"A\", 3, \".\")",
    "output": "\"..A\""
   },
   {
    "input": "padStart(123, 5, 0)",
    "output": "\"00123\""
   },
   {
    "input": "\"A\".padStart(3, \".\")",
    "output": "\"..A\""
   },
   {
    "input": "123.padStart(5, 0)",
    "output": "\"00123\""
   }
  ]
 },
 "padEnd": {
  "name": "padEnd",
  "syntax": [
   "padEnd(text, targetLength, padString)",
   "text.padEnd(targetLength, padString)"
  ],
  "description": "Adds padding after text until it reaches the requested length.",
  "examples": [
   {
    "input": "padEnd(\"A\", 3, \".\")",
    "output": "\"A..\""
   },
   {
    "input": "padEnd(123, 5, 0)",
    "output": "\"12300\""
   },
   {
    "input": "\"A\".padEnd(3, \".\")",
    "output": "\"A..\""
   },
   {
    "input": "123.padEnd(5, 0)",
    "output": "\"12300\""
   }
  ]
 },
 "link": {
  "name": "link",
  "syntax": [
   "link(text, url)",
   "text.link(url)"
  ],
  "description": "Attaches a URL to display text.",
  "examples": [
   {
    "input": "link(\"Orbit\", \"https://example.com\")",
    "output": null
   },
   {
    "input": "\"Orbit\".link(\"https://example.com\")",
    "output": null
   }
  ]
 },
 "style": {
  "name": "style",
  "syntax": [
   "style(value, styles)",
   "value.style(styles)"
  ],
  "description": "Applies text styles or colors. Styles include “b”, “u”, “i”, “c”, and “s”; colors include gray, brown, orange, yellow, green, blue, purple, pink, and red, with “_background” for a background color.",
  "examples": [
   {
    "input": "style(\"Orbit\", \"b\", \"u\")",
    "output": null
   },
   {
    "input": "style(\"Orbit\", \"blue\", \"gray_background\")",
    "output": null
   },
   {
    "input": "\"Orbit\".style(\"b\", \"u\")",
    "output": null
   },
   {
    "input": "\"Orbit\".style(\"blue\", \"blue_background\")",
    "output": null
   }
  ]
 },
 "unstyle": {
  "name": "unstyle",
  "syntax": [
   "unstyle(value, styles?)",
   "value.unstyle(styles?)"
  ],
  "description": "Strips selected styles from text, or all styles when none are listed.",
  "examples": [
   {
    "input": "unstyle(style(\"Text\", \"b\", \"c\"))",
    "output": null
   },
   {
    "input": "unstyle(style(\"Text\", \"blue\", \"b\"), \"blue\")",
    "output": null
   },
   {
    "input": "style(\"Text\", \"b\", \"c\").unstyle()",
    "output": null
   },
   {
    "input": "style(\"Text\", \"blue\", \"b\").unstyle(\"blue\")",
    "output": null
   }
  ]
 },
 "format": {
  "name": "format",
  "syntax": [
   "format(value)",
   "value.format()"
  ],
  "description": "Turns a value into its display text.",
  "examples": [
   {
    "input": "format(1234)",
    "output": "\"1234\""
   },
   {
    "input": "format(now())",
    "output": null
   },
   {
    "input": "1234.format()",
    "output": "\"1234\""
   },
   {
    "input": "now().format()",
    "output": null
   }
  ]
 },
 "formatNumber": {
  "name": "formatNumber",
  "syntax": [
   "formatNumber(value, format?, precision?)",
   "value.formatNumber(format?, precision?)"
  ],
  "description": "Formats a number as text. Choose commas, percent, humanize, binary or decimal bytes, or a supported currency code, and optionally set 0 to 12 decimal places.",
  "examples": [
   {
    "input": "formatNumber(12.345, \"usd\")",
    "output": "\"$12.35\""
   },
   {
    "input": "formatNumber(12.345, \"usd\", 0)",
    "output": "\"$12\""
   },
   {
    "input": "formatNumber(1234567890, \"commas\")",
    "output": "\"1,234,567,890\""
   },
   {
    "input": "formatNumber(1234567890, \"humanize\")",
    "output": "\"1.2B\""
   },
   {
    "input": "12.345.formatNumber(\"usd\")",
    "output": "\"$12.35\""
   },
   {
    "input": "12.345.formatNumber(\"usd\", 0)",
    "output": "\"$12\""
   },
   {
    "input": "1234567890.formatNumber(\"commas\")",
    "output": "\"1,234,567,890\""
   },
   {
    "input": "1234567890.formatNumber(\"humanize\")",
    "output": "\"1.2B\""
   }
  ]
 },
 "divide": {
  "name": "divide",
  "syntax": [
   "divide(number, number)",
   "number.divide(number)"
  ],
  "description": "Divides the first number by the second.",
  "examples": [
   {
    "input": "divide(5, 10)",
    "output": "0.5"
   },
   {
    "input": "5 / 10",
    "output": "0.5"
   },
   {
    "input": "5.divide(10)",
    "output": "0.5"
   },
   {
    "input": "5 / 10",
    "output": "0.5"
   }
  ]
 },
 "min": {
  "name": "min",
  "syntax": [
   "min(list)",
   "list.min()"
  ],
  "description": "Finds the smallest supplied number.",
  "examples": [
   {
    "input": "min(1, 2, 3)",
    "output": "1"
   },
   {
    "input": "min([1, 2, 3])",
    "output": "1"
   },
   {
    "input": "[1, 2, 3].min()",
    "output": "1"
   }
  ]
 },
 "max": {
  "name": "max",
  "syntax": [
   "max(list)",
   "list.max()"
  ],
  "description": "Finds the largest supplied number.",
  "examples": [
   {
    "input": "max(1, 2, 3)",
    "output": "3"
   },
   {
    "input": "max([1, 2, 3])",
    "output": "3"
   },
   {
    "input": "[1, 2, 3].max()",
    "output": "3"
   }
  ]
 },
 "sum": {
  "name": "sum",
  "syntax": [
   "sum(list)",
   "list.sum()"
  ],
  "description": "Adds all supplied numbers.",
  "examples": [
   {
    "input": "sum(1, 2, 3)",
    "output": "6"
   },
   {
    "input": "sum([1, 2, 3], 4, 5)",
    "output": "15"
   },
   {
    "input": "[1, 2, 3].sum()",
    "output": "6"
   },
   {
    "input": "[1, 2, 3].sum(4, 5)",
    "output": "15"
   }
  ]
 },
 "median": {
  "name": "median",
  "syntax": [
   "median(list)",
   "list.median()"
  ],
  "description": "Finds the middle number after sorting the values.",
  "examples": [
   {
    "input": "median(1, 2, 4)",
    "output": "2"
   },
   {
    "input": "median([1, 2, 3], 4)",
    "output": "2.5"
   },
   {
    "input": "[1, 2, 4].median()",
    "output": "2"
   },
   {
    "input": "[1, 2, 3].median(4)",
    "output": "2.5"
   }
  ]
 },
 "mean": {
  "name": "mean",
  "syntax": [
   "mean(list)",
   "list.mean()"
  ],
  "description": "Calculates the arithmetic mean.",
  "examples": [
   {
    "input": "mean(1, 2, 3)",
    "output": "2"
   },
   {
    "input": "mean([1, 2, 3], 4, 5)",
    "output": "3"
   },
   {
    "input": "[1, 2, 3].mean()",
    "output": "2"
   },
   {
    "input": "[1, 2, 3].mean(4, 5)",
    "output": "3"
   }
  ]
 },
 "round": {
  "name": "round",
  "syntax": [
   "round(value, precision)",
   "value.round(precision)"
  ],
  "description": "Rounds a number, optionally to a chosen precision.",
  "examples": [
   {
    "input": "round(1.2345)",
    "output": "1"
   },
   {
    "input": "round(1.2345, 2)",
    "output": "1.23"
   }
  ]
 },
 "toNumber": {
  "name": "toNumber",
  "syntax": [
   "toNumber(value)",
   "value.toNumber()"
  ],
  "description": "Converts a compatible value into a number.",
  "examples": [
   {
    "input": "toNumber(\"2\")",
    "output": "2"
   },
   {
    "input": "toNumber(now())",
    "output": null
   },
   {
    "input": "toNumber(true)",
    "output": "1"
   },
   {
    "input": "\"2\".toNumber()",
    "output": "2"
   },
   {
    "input": "now().toNumber()",
    "output": null
   },
   {
    "input": "true.toNumber()",
    "output": "1"
   }
  ]
 },
 "now": {
  "name": "now",
  "syntax": [
   "now()"
  ],
  "description": "Provides the current date and time.",
  "examples": [
   {
    "input": "now()",
    "output": null
   }
  ]
 },
 "today": {
  "name": "today",
  "syntax": [
   "today()"
  ],
  "description": "Provides today’s date without a time.",
  "examples": [
   {
    "input": "today()",
    "output": null
   }
  ]
 },
 "minute": {
  "name": "minute",
  "syntax": [
   "minute(date)",
   "date.minute()"
  ],
  "description": "Reads the minute component, from 0 through 59.",
  "examples": [
   {
    "input": "minute(parseDate(\"2023-07-10T17:35Z\"))",
    "output": "35"
   },
   {
    "input": "parseDate(\"2023-07-10T17:35Z\").minute()",
    "output": "35"
   }
  ]
 },
 "hour": {
  "name": "hour",
  "syntax": [
   "hour(date)",
   "date.hour()"
  ],
  "description": "Reads the hour component, from 0 through 23.",
  "examples": [
   {
    "input": "hour(parseDate(\"2023-07-10T17:35Z\"))",
    "output": "17"
   },
   {
    "input": "parseDate(\"2023-07-10T17:35Z\").hour()",
    "output": "17"
   }
  ]
 },
 "day": {
  "name": "day",
  "syntax": [
   "day(date)",
   "date.day()"
  ],
  "description": "Reads the weekday number, from Monday 1 through Sunday 7.",
  "examples": [
   {
    "input": "day(parseDate(\"2023-07-10T17:35Z\"))",
    "output": "1"
   },
   {
    "input": "parseDate(\"2023-07-10T17:35Z\").day()",
    "output": "1"
   }
  ]
 },
 "date": {
  "name": "date",
  "syntax": [
   "date(date)",
   "date.date()"
  ],
  "description": "Reads the day of the month, from 1 through 31.",
  "examples": [
   {
    "input": "date(parseDate(\"2023-07-10T17:35Z\"))",
    "output": "10"
   },
   {
    "input": "parseDate(\"2023-07-10T17:35Z\").date()",
    "output": "10"
   }
  ]
 },
 "week": {
  "name": "week",
  "syntax": [
   "week(date)",
   "date.week()"
  ],
  "description": "Reads the ISO week number, from 1 through 53.",
  "examples": [
   {
    "input": "week(parseDate(\"2023-01-02\"))",
    "output": "1"
   },
   {
    "input": "parseDate(\"2023-01-02\").week()",
    "output": "1"
   }
  ]
 },
 "month": {
  "name": "month",
  "syntax": [
   "month(date)",
   "date.month()"
  ],
  "description": "Reads the month number, from 1 through 12.",
  "examples": [
   {
    "input": "month(parseDate(\"2023-07-10T17:35Z\"))",
    "output": "7"
   },
   {
    "input": "parseDate(\"2023-07-10T17:35Z\").month()",
    "output": "7"
   }
  ]
 },
 "year": {
  "name": "year",
  "syntax": [
   "year(date)",
   "date.year()"
  ],
  "description": "Reads the four-digit year.",
  "examples": [
   {
    "input": "year(now())",
    "output": null
   },
   {
    "input": "now().year()",
    "output": null
   }
  ]
 },
 "dateAdd": {
  "name": "dateAdd",
  "syntax": [
   "dateAdd(date, num, unit)",
   "date.dateAdd(num, unit)"
  ],
  "description": "Moves a date forward by the requested amount and unit.",
  "examples": [
   {
    "input": "dateAdd(now(), 1, \"days\")",
    "output": null
   },
   {
    "input": "dateAdd(now(), 2, \"months\")",
    "output": null
   },
   {
    "input": "dateAdd(now(), 3, \"years\")",
    "output": null
   },
   {
    "input": "now().dateAdd(1, \"days\")",
    "output": null
   },
   {
    "input": "now().dateAdd(2, \"months\")",
    "output": null
   },
   {
    "input": "now().dateAdd(3, \"years\")",
    "output": null
   }
  ]
 },
 "dateSubtract": {
  "name": "dateSubtract",
  "syntax": [
   "dateSubtract(date, num, unit)",
   "date.dateSubtract(num, unit)"
  ],
  "description": "Moves a date backward by the requested amount and unit.",
  "examples": [
   {
    "input": "dateSubtract(now(), 1, \"days\")",
    "output": null
   },
   {
    "input": "dateSubtract(now(), 2, \"months\")",
    "output": null
   },
   {
    "input": "dateSubtract(now(), 3, \"years\")",
    "output": null
   },
   {
    "input": "now().dateSubtract(1, \"days\")",
    "output": null
   },
   {
    "input": "now().dateSubtract(2, \"months\")",
    "output": null
   },
   {
    "input": "now().dateSubtract(3, \"years\")",
    "output": null
   }
  ]
 },
 "dateBetween": {
  "name": "dateBetween",
  "syntax": [
   "dateBetween(date, date, unit)",
   "date.dateBetween(date, unit)"
  ],
  "description": "Measures the gap between two dates in the requested unit.",
  "examples": [
   {
    "input": "dateBetween(now(), parseDate(\"2022-09-07\"), \"days\")",
    "output": null
   },
   {
    "input": "dateBetween(parseDate(\"2030-01-01\"), now(), \"years\")",
    "output": null
   },
   {
    "input": "now().dateBetween(parseDate(\"2022-09-07\"), \"days\")",
    "output": null
   },
   {
    "input": "parseDate(\"2030-01-01\").dateBetween(now(), \"years\")",
    "output": null
   }
  ]
 },
 "dateRange": {
  "name": "dateRange",
  "syntax": [
   "dateRange(start, end)"
  ],
  "description": "Builds a date range from start and end values.",
  "examples": [
   {
    "input": "dateRange(prop(\"From\"), prop(\"To\"))",
    "output": "@September 7, 2022 → September 7, 2023"
   },
   {
    "input": "prop(\"From\").dateRange(prop(\"To\"))",
    "output": "@September 7, 2022 → September 7, 2023"
   }
  ]
 },
 "dateStart": {
  "name": "dateStart",
  "syntax": [
   "dateStart(dateRange)",
   "dateRange.dateStart()"
  ],
  "description": "Gets the first date in a date range.",
  "examples": [
   {
    "input": "dateStart(prop(\"Window\"))",
    "output": "@September 7, 2022"
   },
   {
    "input": "dateBetween(dateStart(prop(\"Window\")), dateEnd(prop(\"Window\")), \"days\")",
    "output": "-365"
   },
   {
    "input": "prop(\"Window\").dateStart()",
    "output": "@September 7, 2022"
   },
   {
    "input": "prop(\"Window\").dateStart().dateBetween(prop(\"Window\").dateEnd(), \"days\")",
    "output": "-365"
   }
  ]
 },
 "dateEnd": {
  "name": "dateEnd",
  "syntax": [
   "dateEnd(dateRange)",
   "dataRange.dateEnd()"
  ],
  "description": "Gets the last date in a date range.",
  "examples": [
   {
    "input": "dateEnd(prop(\"Window\"))",
    "output": "@September 7, 2023"
   },
   {
    "input": "dateBetween(dateEnd(prop(\"Window\")), dateStart(prop(\"Window\")), \"days\")",
    "output": "365"
   },
   {
    "input": "prop(\"Window\").dateEnd()",
    "output": "@September 7, 2023"
   },
   {
    "input": "prop(\"Window\").dateEnd().dateBetween(prop(\"Window\").dateStart(), \"days\")",
    "output": "365"
   }
  ]
 },
 "timestamp": {
  "name": "timestamp",
  "syntax": [
   "timestamp(date)",
   "date.timestamp()"
  ],
  "description": "Converts the current date value to Unix milliseconds since 1970-01-01.",
  "examples": [
   {
    "input": "timestamp(now())",
    "output": null
   },
   {
    "input": "now().timestamp()",
    "output": null
   }
  ]
 },
 "fromTimestamp": {
  "name": "fromTimestamp",
  "syntax": [
   "fromTimestamp(timestamp)",
   "timestamp.fromTimestamp()"
  ],
  "description": "Turns Unix milliseconds since 1970-01-01 into a date.",
  "examples": [
   {
    "input": "fromTimestamp(1689024900000)",
    "output": null
   },
   {
    "input": "1689024900000.fromTimestamp()",
    "output": null
   }
  ]
 },
 "formatDate": {
  "name": "formatDate",
  "syntax": [
   "formatDate(date, format, timezone?)",
   "date.formatDate(format, timezone?)"
  ],
  "description": "Renders a date with a custom format and optional timezone.",
  "examples": [
   {
    "input": "formatDate(now(), \"MMMM D, Y\")",
    "output": null
   },
   {
    "input": "formatDate(now(), \"YYYY-MM-DD HH:mm\")",
    "output": null
   },
   {
    "input": "formatDate(now(), \"h:mm A\", \"UTC+1\")",
    "output": null
   },
   {
    "input": "now().formatDate(\"MMMM D, Y\")",
    "output": null
   },
   {
    "input": "now().formatDate(\"YYYY-MM-DD HH:mm\")",
    "output": null
   },
   {
    "input": "now().formatDate(\"h:mm A\", \"UTC+1\")",
    "output": null
   }
  ]
 },
 "parseDate": {
  "name": "parseDate",
  "syntax": [
   "parseDate(dateText)",
   "dateText.parseDate()"
  ],
  "description": "Reads an ISO 8601 date string.",
  "examples": [
   {
    "input": "parseDate(\"2022-01-01\")",
    "output": null
   },
   {
    "input": "parseDate(\"2022-01-01T00:00Z\")",
    "output": null
   },
   {
    "input": "\"2022-01-01\".parseDate()",
    "output": null
   },
   {
    "input": "\"2022-01-01T00:00Z\".parseDate()",
    "output": null
   }
  ]
 },
 "name": {
  "name": "name",
  "syntax": [
   "name(person)",
   "person.name()"
  ],
  "description": "Gets a person’s display name.",
  "examples": [
   {
    "input": "name(prop(\"Owner\"))",
    "output": null
   },
   {
    "input": "prop(\"Inventors\").map(name(current)).join(\", \")",
    "output": "\"Katherine Johnson, Alan Turing\""
   },
   {
    "input": "prop(\"Owner\").name()",
    "output": null
   },
   {
    "input": "prop(\"Inventors\").map(current.name()).join(\", \")",
    "output": "\"Katherine Johnson, Alan Turing\""
   }
  ]
 },
 "email": {
  "name": "email",
  "syntax": [
   "email(person)",
   "person.email()"
  ],
  "description": "Gets a person’s email address.",
  "examples": [
   {
    "input": "email(prop(\"Owner\"))",
    "output": null
   },
   {
    "input": "prop(\"Contributors\").map(email(current)).join(\", \")",
    "output": null
   },
   {
    "input": "prop(\"Owner\").email()",
    "output": null
   },
   {
    "input": "prop(\"Contributors\").map(current.email()).join(\", \")",
    "output": null
   }
  ]
 },
 "at": {
  "name": "at",
  "syntax": [
   "at(list, index)",
   "list.at(index)"
  ],
  "description": "Reads the item at a list index.",
  "examples": [
   {
    "input": "at([1, 2, 3], 1)",
    "output": "2"
   },
   {
    "input": "[1, 2, 3].at(1)",
    "output": "2"
   }
  ]
 },
 "first": {
  "name": "first",
  "syntax": [
   "first(list)",
   "list.first()"
  ],
  "description": "Gets the first list item.",
  "examples": [
   {
    "input": "first([1, 2, 3])",
    "output": "1"
   },
   {
    "input": "[1, 2, 3].first()",
    "output": "1"
   },
   {
    "input": "[].first()",
    "output": null
   }
  ]
 },
 "last": {
  "name": "last",
  "syntax": [
   "last(list)",
   "list.last()"
  ],
  "description": "Gets the final list item.",
  "examples": [
   {
    "input": "last([1, 2, 3])",
    "output": "3"
   },
   {
    "input": "[1, 2, 3].last()",
    "output": "3"
   }
  ]
 },
 "slice": {
  "name": "slice",
  "syntax": [
   "slice(list, startIndex, endIndex?)",
   "list.slice(startIndex, endIndex?)"
  ],
  "description": "Copies a section of a list from the start index to the optional end index.",
  "examples": [
   {
    "input": "slice([1, 2, 3], 1, 2)",
    "output": "[2]"
   },
   {
    "input": "slice([\"a\", \"b\", \"c\"], 1)",
    "output": "[\"b\", \"c\"]"
   },
   {
    "input": "[1, 2, 3].slice(1, 2)",
    "output": "[2]"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].slice(1)",
    "output": "[\"b\", \"c\"]"
   }
  ]
 },
 "splice": {
  "name": "splice",
  "syntax": [
   "splice(list, startIndex, deleteCount?, ...)",
   "list.splice(startIndex, deleteCount?, ...)"
  ],
  "description": "Removes list items and can insert replacements at the same position.",
  "examples": [
   {
    "input": "splice([1, 2, 3], 1, 1)",
    "output": "[1, 3]"
   },
   {
    "input": "splice([\"a\", \"b\", \"c\"], 0, 1, \"d\")",
    "output": "[\"d\", \"b\", \"c\"]"
   },
   {
    "input": "[1, 2, 3].splice(1, 1)",
    "output": "[1, 3]"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].splice(0, 1, \"d\")",
    "output": "[\"d\", \"b\", \"c\"]"
   }
  ]
 },
 "concat": {
  "name": "concat",
  "syntax": [
   "concat(list, list2, ...)",
   "list.concat(list2, ...)"
  ],
  "description": "Joins several lists into one list.",
  "examples": [
   {
    "input": "concat([1, 2], [3, 4])",
    "output": "[1, 2, 3, 4]"
   },
   {
    "input": "concat([\"a\", \"b\"], [\"c\", \"d\"])",
    "output": "[\"a\", \"b\", \"c\", \"d\"]"
   },
   {
    "input": "[1, 2].concat([3, 4])",
    "output": "[1, 2, 3, 4]"
   },
   {
    "input": "[\"a\", \"b\"].concat([\"c\", \"d\"])",
    "output": "[\"a\", \"b\", \"c\", \"d\"]"
   }
  ]
 },
 "sort": {
  "name": "sort",
  "syntax": [
   "sort(list, expression?)",
   "list.sort(expression?)"
  ],
  "description": "Orders a list, optionally using an expression as the sort key.",
  "examples": [
   {
    "input": "sort([3, 1, 2])",
    "output": "[1, 2, 3]"
   },
   {
    "input": "sort([1, 2, 3]).reverse()",
    "output": "[3, 2, 1]"
   },
   {
    "input": "sort([\"Yash\", \"Stephen\", \"Paul\", \"Simon\", \"Ryo\"])",
    "output": "[\"Paul\", \"Ryo\", \"Simon\", \"Stephen\", \"Yash\"]"
   },
   {
    "input": "sort(prop(\"Tasks\"), current.prop(\"Priority\"))",
    "output": null
   },
   {
    "input": "[3, 1, 2].sort()",
    "output": "[1, 2, 3]"
   },
   {
    "input": "prop(\"Tasks\").sort(current.prop(\"Priority\"))",
    "output": null
   }
  ]
 },
 "reverse": {
  "name": "reverse",
  "syntax": [
   "reverse(list)",
   "list.reverse()"
  ],
  "description": "Returns a list in reverse order.",
  "examples": [
   {
    "input": "reverse([\"green\", \"eggs\", \"ham\"])",
    "output": "[\"ham\", \"eggs\", \"green\"]"
   },
   {
    "input": "[\"green\", \"eggs\", \"ham\"].reverse()",
    "output": "[\"ham\", \"eggs\", \"green\"]"
   }
  ]
 },
 "join": {
  "name": "join",
  "syntax": [
   "join(list, joiner)",
   "list.join(joiner)"
  ],
  "description": "Combines list values with a separator.",
  "examples": [
   {
    "input": "join([\"a\", \"b\", \"c\"], \", \")",
    "output": "\"a, b, c\""
   },
   {
    "input": "join([\"dog\", \"go\"], \"\")",
    "output": "\"doggo\""
   },
   {
    "input": "[\"a\", \"b\", \"c\"].join(\", \")",
    "output": "\"a, b, c\""
   },
   {
    "input": "[\"dog\", \"go\"].join(\"\")",
    "output": "\"doggo\""
   }
  ]
 },
 "split": {
  "name": "split",
  "syntax": [
   "split(text, separator)",
   "text.split(separator)"
  ],
  "description": "Breaks text into a list using a separator.",
  "examples": [
   {
    "input": "split(\"apple,pear,orange\", \",\")",
    "output": "[\"apple\", \"pear\", \"orange\"]"
   },
   {
    "input": "\"apple,pear,orange\".split(\",\")",
    "output": "[\"apple\", \"pear\", \"orange\"]"
   }
  ]
 },
 "unique": {
  "name": "unique",
  "syntax": [
   "unique(list)",
   "list.unique()"
  ],
  "description": "Removes duplicate values from a list.",
  "examples": [
   {
    "input": "unique([1, 1, 2])",
    "output": "[1, 2]"
   },
   {
    "input": "[1, 1, 2].unique()",
    "output": "[1, 2]"
   }
  ]
 },
 "includes": {
  "name": "includes",
  "syntax": [
   "includes(list, search)",
   "list.includes(search)"
  ],
  "description": "Checks whether a list contains a value.",
  "examples": [
   {
    "input": "includes([\"a\", \"b\", \"c\"], \"b\")",
    "output": "true"
   },
   {
    "input": "includes([1, 2, 3], 4)",
    "output": "false"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].includes(\"b\")",
    "output": "true"
   },
   {
    "input": "[1, 2, 3].includes(4)",
    "output": "false"
   }
  ]
 },
 "find": {
  "name": "find",
  "syntax": [
   "find(list, condition)",
   "list.find(condition)"
  ],
  "description": "Returns the first list item whose condition passes.",
  "examples": [
   {
    "input": "find([\"a\", \"b\", \"c\"], current == \"b\")",
    "output": "\"b\""
   },
   {
    "input": "find([1, 2, 3], current > 100)",
    "output": null
   },
   {
    "input": "[\"a\", \"b\", \"c\"].find(current == \"b\")",
    "output": "\"b\""
   },
   {
    "input": "[1, 2, 3].find(current > 100)",
    "output": null
   }
  ]
 },
 "findIndex": {
  "name": "findIndex",
  "syntax": [
   "findIndex(list, condition)",
   "list.findIndex(condition)"
  ],
  "description": "Returns the index of the first item whose condition passes.",
  "examples": [
   {
    "input": "findIndex([\"a\", \"b\", \"c\"], current == \"b\")",
    "output": "1"
   },
   {
    "input": "findIndex([1, 2, 3], current > 100)",
    "output": "-1"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].findIndex(current == \"b\")",
    "output": "1"
   },
   {
    "input": "[1, 2, 3].findIndex(current > 100)",
    "output": "-1"
   }
  ]
 },
 "filter": {
  "name": "filter",
  "syntax": [
   "filter(list, condition)",
   "list.filter(condition)"
  ],
  "description": "Keeps list items whose condition passes.",
  "examples": [
   {
    "input": "filter([1, 2, 3], current > 1)",
    "output": "[2, 3]"
   },
   {
    "input": "filter([\"a\", \"b\", \"c\"], current == \"a\")",
    "output": "[\"a\"]"
   },
   {
    "input": "[1, 2, 3].filter(current > 1)",
    "output": "[2, 3]"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].filter(current == \"a\")",
    "output": "[\"a\"]"
   }
  ]
 },
 "some": {
  "name": "some",
  "syntax": [
   "some(list, expression)",
   "list.some(expression)"
  ],
  "description": "Checks whether any list item passes the condition.",
  "examples": [
   {
    "input": "some([1, 2, 3], current == 2)",
    "output": "true"
   },
   {
    "input": "some([\"a\", \"b\", \"c\"], current.length > 2)",
    "output": "false"
   },
   {
    "input": "[1, 2, 3].some(current == 2)",
    "output": "true"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].some(current.length > 2)",
    "output": "false"
   }
  ]
 },
 "every": {
  "name": "every",
  "syntax": [
   "every(list, condition)",
   "list.every(condition)"
  ],
  "description": "Checks whether all list items pass the condition.",
  "examples": [
   {
    "input": "every([1, 2, 3], current > 0)",
    "output": "true"
   },
   {
    "input": "every([\"a\", \"b\", \"c\"], current == \"b\")",
    "output": "false"
   },
   {
    "input": "[1, 2, 3].every(current > 0)",
    "output": "true"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].every(current == \"b\")",
    "output": "false"
   }
  ]
 },
 "map": {
  "name": "map",
  "syntax": [
   "map(list, expression)",
   "list.map(expression)"
  ],
  "description": "Evaluates an expression for each list item and returns the results.",
  "examples": [
   {
    "input": "map([1, 2, 3], current + 1)",
    "output": "[2, 3, 4]"
   },
   {
    "input": "map([1, 2, 3], current + index)",
    "output": "[1, 3, 5]"
   },
   {
    "input": "[1, 2, 3].map(current + 1)",
    "output": "[2, 3, 4]"
   },
   {
    "input": "[1, 2, 3].map(current + index)",
    "output": "[1, 3, 5]"
   }
  ]
 },
 "flat": {
  "name": "flat",
  "syntax": [
   "flat(list, list2?, ...)",
   "list.flat(list2?, ...)"
  ],
  "description": "Combines nested lists into one level.",
  "examples": [
   {
    "input": "flat([1, 2, 3])",
    "output": "[1, 2, 3]"
   },
   {
    "input": "flat([[1, 2], [3, 4]])",
    "output": "[1, 2, 3, 4]"
   },
   {
    "input": "[1, 2, 3].flat()",
    "output": "[1, 2, 3]"
   },
   {
    "input": "[[1, 2], [3, 4]].flat()",
    "output": "[1, 2, 3, 4]"
   }
  ]
 },
 "id": {
  "name": "id",
  "syntax": [
   "id(value?)",
   "value.id()"
  ],
  "description": "Gets the id of a page or person, or the current row when no value is supplied.",
  "examples": [
   {
    "input": "id()",
    "output": null
   },
   {
    "input": "id(prop(\"Links\").first())",
    "output": null
   },
   {
    "input": "prop(\"Links\").first().id()",
    "output": null
   }
  ]
 },
 "equal": {
  "name": "equal",
  "syntax": [
   "equal(value, value)",
   "value.equal(value)"
  ],
  "description": "Checks whether two values are equal.",
  "examples": [
   {
    "input": "equal(1, 1)",
    "output": "true"
   },
   {
    "input": "\"a\" == \"b\"",
    "output": "false"
   },
   {
    "input": "1.equal(1)",
    "output": "true"
   },
   {
    "input": "\"a\" == \"b\"",
    "output": "false"
   }
  ]
 },
 "unequal": {
  "name": "unequal",
  "syntax": [
   "unequal(value, value)",
   "value.unequal(value)"
  ],
  "description": "Checks whether two values differ.",
  "examples": [
   {
    "input": "unequal(1, 2)",
    "output": "true"
   },
   {
    "input": "\"a\" != \"a\"",
    "output": "false"
   },
   {
    "input": "1.unequal(2)",
    "output": "true"
   },
   {
    "input": "\"a\" != \"a\"",
    "output": "false"
   }
  ]
 },
 "let": {
  "name": "let",
  "syntax": [
   "let(variable, value, expression)",
   "variable.let(value, expression)"
  ],
  "description": "Binds one name and evaluates an expression with that value.",
  "examples": [
   {
    "input": "let(name, \"Margaret Hamilton\", \"Hello, \" + name + \"!\")",
    "output": "\"Hello, Margaret Hamilton!\""
   },
   {
    "input": "let(radius, 4, round(pi() * radius ^ 2))",
    "output": "50"
   },
   {
    "input": "name.let(\"Grace Hopper\", \"Hello, \" + name + \"!\")",
    "output": "\"Hello, Grace Hopper!\""
   },
   {
    "input": "radius.let(4, round(pi() * radius ^ 2))",
    "output": "50"
   }
  ]
 },
 "lets": {
  "name": "lets",
  "syntax": [
   "lets(variable, value, variable2, value2, ..., expression)",
   "variable.lets(value, variable2, value2, ..., expression)"
  ],
  "description": "Binds several names before evaluating an expression.",
  "examples": [
   {
    "input": "lets(a, \"Hello\", b, \"world\", a + \" \" + b)",
    "output": "\"Hello world\""
   },
   {
    "input": "lets(base, 3, height, 8, base * height / 2)",
    "output": "12"
   }
  ]
 },
 "count": {
  "name": "count",
  "syntax": [
   "count(list, condition)",
   "list.count(condition)"
  ],
  "description": "Counts matching list items, or all items when no condition is supplied.",
  "examples": [
   {
    "input": "count([1, 2, 3, 4], current % 2 == 0)",
    "output": "2"
   },
   {
    "input": "count([\"a\", \"b\", \"c\"], current == \"d\")",
    "output": "0"
   },
   {
    "input": "[1, 2, 3, 4].count(current % 2 == 0)",
    "output": "2"
   },
   {
    "input": "[\"a\", \"b\", \"c\"].count(current == \"d\")",
    "output": "0"
   }
  ]
 },
 "add": {
  "name": "add",
  "syntax": [
   "add(number, number)",
   "number.add(number)",
   "lhs + rhs"
  ],
  "description": "Adds two numbers.",
  "examples": [
   {
    "input": "add(5, 10)",
    "output": "15"
   },
   {
    "input": "5 + 10",
    "output": "15"
   }
  ]
 },
 "subtract": {
  "name": "subtract",
  "syntax": [
   "subtract(number, number)",
   "number.subtract(number)",
   "lhs - rhs"
  ],
  "description": "Subtracts the second number from the first.",
  "examples": [
   {
    "input": "subtract(5, 10)",
    "output": "-5"
   },
   {
    "input": "5 - 10",
    "output": "-5"
   }
  ]
 },
 "multiply": {
  "name": "multiply",
  "syntax": [
   "multiply(number, number)",
   "number.multiply(number)",
   "lhs * rhs"
  ],
  "description": "Multiplies two numeric values.",
  "examples": [
   {
    "input": "multiply(5, 10)",
    "output": "50"
   },
   {
    "input": "5 * 10",
    "output": "50"
   }
  ]
 },
 "mod": {
  "name": "mod",
  "syntax": [
   "mod(number, number)",
   "number.mod(number)",
   "lhs % rhs"
  ],
  "description": "Returns the remainder after division.",
  "examples": [
   {
    "input": "mod(5, 10)",
    "output": "5"
   },
   {
    "input": "5 % 10",
    "output": "5"
   }
  ]
 },
 "pow": {
  "name": "pow",
  "syntax": [
   "pow(number, number)",
   "number.pow(number)",
   "lhs ^ rhs"
  ],
  "description": "Raises a base number to a power.",
  "examples": [
   {
    "input": "pow(5, 10)",
    "output": "9765625"
   },
   {
    "input": "5 ^ 10",
    "output": "9765625"
   }
  ]
 },
 "abs": {
  "name": "abs",
  "syntax": [
   "abs(number)",
   "number.abs()"
  ],
  "description": "Returns a number’s magnitude without its sign.",
  "examples": [
   {
    "input": "abs(10)",
    "output": "10"
   },
   {
    "input": "abs(-10)",
    "output": "10"
   }
  ]
 },
 "ceil": {
  "name": "ceil",
  "syntax": [
   "ceil(number)",
   "number.ceil()"
  ],
  "description": "Rounds upward to the next integer.",
  "examples": [
   {
    "input": "ceil(0.4)",
    "output": "1"
   },
   {
    "input": "ceil(-0.6)",
    "output": "0"
   }
  ]
 },
 "floor": {
  "name": "floor",
  "syntax": [
   "floor(number)",
   "number.floor()"
  ],
  "description": "Rounds downward to the previous integer.",
  "examples": [
   {
    "input": "floor(0.4)",
    "output": "0"
   },
   {
    "input": "floor(-0.6)",
    "output": "-1"
   }
  ]
 },
 "sqrt": {
  "name": "sqrt",
  "syntax": [
   "sqrt(number)",
   "number.sqrt()"
  ],
  "description": "Calculates the positive square root.",
  "examples": [
   {
    "input": "sqrt(4)",
    "output": "2"
   },
   {
    "input": "sqrt(7)",
    "output": "2.6457513110645907"
   }
  ]
 },
 "cbrt": {
  "name": "cbrt",
  "syntax": [
   "cbrt(number)",
   "number.cbrt()"
  ],
  "description": "Calculates the cube root.",
  "examples": [
   {
    "input": "cbrt(9)",
    "output": "2.080083823051904"
   },
   {
    "input": "cbrt(64)",
    "output": "4"
   }
  ]
 },
 "exp": {
  "name": "exp",
  "syntax": [
   "exp(number)",
   "number.exp()"
  ],
  "description": "Calculates e raised to the supplied power.",
  "examples": [
   {
    "input": "exp(1)",
    "output": "2.718281828459045"
   },
   {
    "input": "exp(-1)",
    "output": "0.36787944117144233"
   }
  ]
 },
 "ln": {
  "name": "ln",
  "syntax": [
   "ln(number)",
   "number.ln()"
  ],
  "description": "Calculates the natural logarithm.",
  "examples": [
   {
    "input": "ln(2.718281828459045)",
    "output": "1"
   },
   {
    "input": "ln(10)",
    "output": "2.302585092994046"
   }
  ]
 },
 "log10": {
  "name": "log10",
  "syntax": [
   "log10(number)",
   "number.log10()"
  ],
  "description": "Calculates the base-10 logarithm.",
  "examples": [
   {
    "input": "log10(10)",
    "output": "1"
   },
   {
    "input": "log10(100000)",
    "output": "5"
   }
  ]
 },
 "log2": {
  "name": "log2",
  "syntax": [
   "log2(number)",
   "number.log2()"
  ],
  "description": "Calculates the base-2 logarithm.",
  "examples": [
   {
    "input": "log2(4)",
    "output": "2"
   },
   {
    "input": "log2(1024)",
    "output": "10"
   }
  ]
 },
 "sign": {
  "name": "sign",
  "syntax": [
   "sign(number)",
   "number.sign()"
  ],
  "description": "Reports 1 for positive, -1 for negative, and 0 for zero.",
  "examples": [
   {
    "input": "sign(-10)",
    "output": "-1"
   },
   {
    "input": "sign(10)",
    "output": "1"
   }
  ]
 },
 "pi": {
  "name": "pi",
  "syntax": [
   "pi()"
  ],
  "description": "Provides the circle constant π.",
  "examples": [
   {
    "input": "pi()",
    "output": "3.141592653589793"
   }
  ]
 },
 "e": {
  "name": "e",
  "syntax": [
   "e()"
  ],
  "description": "Provides Euler’s number.",
  "examples": [
   {
    "input": "e()",
    "output": "2.718281828459045"
   }
  ]
 }
};

export const BUILTIN_DOCS: FormulaBuiltinDoc[] = [
 {
  "symbol": "not",
  "type": "checkbox",
  "description": "Flips a boolean value.",
  "examples": [
   {
    "input": "not true",
    "output": "false"
   },
   {
    "input": "!(2 > 3)",
    "output": "true"
   }
  ]
 },
 {
  "symbol": "true",
  "type": "checkbox",
  "description": "A literal true value.",
  "examples": [
   {
    "input": "true",
    "output": "true"
   }
  ]
 },
 {
  "symbol": "false",
  "type": "checkbox",
  "description": "A literal false value.",
  "examples": [
   {
    "input": "false",
    "output": "false"
   }
  ]
 },
 {
  "symbol": "*",
  "type": "number",
  "description": "Multiplies two numeric values.",
  "examples": [
   {
    "input": "3 * 2",
    "output": "6"
   },
   {
    "input": "multiply(-1, 2)",
    "output": "-2"
   }
  ]
 },
 {
  "symbol": "/",
  "type": "number",
  "description": "Divides one numeric value by another.",
  "examples": [
   {
    "input": "6 / 3",
    "output": "2"
   },
   {
    "input": "divide(6, 3)",
    "output": "2"
   }
  ]
 },
 {
  "symbol": "+",
  "type": "number",
  "description": "Adds two values.",
  "examples": [
   {
    "input": "2 + 3",
    "output": "5"
   },
   {
    "input": "\"Hello \" + \"world\"",
    "output": "\"Hello world\""
   }
  ]
 },
 {
  "symbol": "-",
  "type": "number",
  "description": "Subtracts one number from another.",
  "examples": [
   {
    "input": "5 - 3",
    "output": "2"
   },
   {
    "input": "subtract(5, 3)",
    "output": "2"
   }
  ]
 },
 {
  "symbol": ">",
  "type": "checkbox",
  "description": "Tests whether the left value is greater.",
  "examples": [
   {
    "input": "3 > 2",
    "output": "true"
   }
  ]
 },
 {
  "symbol": ">=",
  "type": "checkbox",
  "description": "Tests whether the left value is at least as large.",
  "examples": [
   {
    "input": "3 >= 3",
    "output": "true"
   }
  ]
 },
 {
  "symbol": "<",
  "type": "checkbox",
  "description": "Tests whether the left value is smaller.",
  "examples": [
   {
    "input": "2 < 3",
    "output": "true"
   }
  ]
 },
 {
  "symbol": "<=",
  "type": "checkbox",
  "description": "Tests whether the left value is no larger.",
  "examples": [
   {
    "input": "2 <= 2",
    "output": "true"
   }
  ]
 },
 {
  "symbol": "==",
  "type": "checkbox",
  "description": "Tests two values for equality.",
  "examples": [
   {
    "input": "1 == 1",
    "output": "true"
   },
   {
    "input": "\"a\" == \"b\"",
    "output": "false"
   }
  ]
 },
 {
  "symbol": "!=",
  "type": "checkbox",
  "description": "Tests whether two values differ.",
  "examples": [
   {
    "input": "1 != 2",
    "output": "true"
   },
   {
    "input": "\"a\" != \"a\"",
    "output": "false"
   }
  ]
 },
 {
  "symbol": "%",
  "type": "number",
  "description": "Returns the remainder from division.",
  "examples": [
   {
    "input": "7 % 3",
    "output": "1"
   },
   {
    "input": "mod(7, 3)",
    "output": "1"
   }
  ]
 },
 {
  "symbol": "^",
  "type": "number",
  "description": "Raises a numeric base to an exponent.",
  "examples": [
   {
    "input": "2 ^ 3",
    "output": "8"
   },
   {
    "input": "pow(2, 3)",
    "output": "8"
   }
  ]
 },
 {
  "symbol": "and",
  "type": "checkbox",
  "description": "Combines conditions with logical AND.",
  "examples": [
   {
    "input": "true and false",
    "output": "false"
   },
   {
    "input": "3 > 2 and 2 > 3",
    "output": "false"
   }
  ]
 },
 {
  "symbol": "or",
  "type": "checkbox",
  "description": "Combines conditions with logical OR.",
  "examples": [
   {
    "input": "A boolean result.",
    "output": "true"
   },
   {
    "input": "3 > 2 or 2 > 3",
    "output": "true"
   }
  ]
 },
 {
  "symbol": "?",
  "type": "unknown",
  "description": "Selects the first branch when true, otherwise the second branch.",
  "examples": [
   {
    "input": "true ? 1 : 2",
    "output": "1"
   }
  ]
 }
];
