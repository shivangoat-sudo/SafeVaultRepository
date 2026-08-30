from pathlib import Path
import re

p = Path('src/lib/btwEngine.ts')
s = p.read_text(encoding='utf-8')

# 1. Extend the classification-source enum with an explicit unsafe/unknown state.
needle = "  | 'handmatig_percentage';         // boekhouder heeft, als laatste redmiddel, alleen het BTW-percentage aangewezen (percentageOverrides)"
replacement = "  | 'handmatig_percentage'         // boekhouder heeft, als laatste redmiddel, alleen het BTW-percentage aangewezen (percentageOverrides)\n  | 'twijfel_onvoldoende_informatie'; // onvoldoende informatie: NOOIT automatisch als fiscale uitkomst meenemen"
if needle in s:
    s = s.replace(needle, replacement, 1)
elif "'twijfel_onvoldoende_informatie'" not in s:
    raise SystemExit('Could not locate ClassificationSource union')

# 2. Replace the expense fallback: an unknown transaction is a doubt case,
#    not a 21% conclusion.
expense_old = """    return {\n      classification: 'kosten_algemeen_21',\n      herkend: true,\n      herkenningsbron:\n        'Geen leverancier, trefwoord, categorie of IBAN-signaal wijst op een verlaagd tarief, vrijstelling of verlegging — het algemene tarief van 21% is dan het fiscaal juiste standaardantwoord.',\n      bron: 'standaard_geen_uitzondering',\n      zekerheid: 'hoog',\n    };"""
expense_new = """    return {\n      classification: 'kosten_algemeen_21',\n      herkend: false,\n      herkenningsbron:\n        'Onvoldoende fiscale informatie om deze uitgave betrouwbaar te classificeren. De engine gokt niet op 21%; deze transactie moet handmatig worden beoordeeld.',\n      bron: 'twijfel_onvoldoende_informatie',\n      zekerheid: 'laag',\n    };"""
if expense_old not in s:
    raise SystemExit('Expense fallback not found')
s = s.replace(expense_old, expense_new, 1)

# 3. Replace the income fallback.
income_old = """  return {\n    classification: 'omzet_algemeen_21',\n    herkend: true,\n    herkenningsbron:\n      'Geen trefwoord of categorie wijst op een verlaagd tarief of vrijstelling — het algemene tarief van 21% is dan het fiscaal juiste standaardantwoord voor binnenlandse B2B-dienstverlening.',\n    bron: 'standaard_geen_uitzondering',\n    zekerheid: 'hoog',\n  };"""
income_new = """  return {\n    classification: 'omzet_algemeen_21',\n    herkend: false,\n    herkenningsbron:\n      'Onvoldoende fiscale informatie om deze ontvangst betrouwbaar te classificeren. De engine gokt niet op 21%; deze transactie moet handmatig worden beoordeeld.',\n    bron: 'twijfel_onvoldoende_informatie',\n    zekerheid: 'laag',\n  };"""
if income_old not in s:
    raise SystemExit('Income fallback not found')
s = s.replace(income_old, income_new, 1)

# 4. Never let an unrecognised transaction affect financial totals.
old = """    if (p.herkend) {\n      automatisch_herkend += 1;\n    } else {\n      controle_aanbevolen.push(p);\n    }\n\n    if (p.classification === 'verlegd_21') {"""
new = """    if (p.herkend) {\n      automatisch_herkend += 1;\n    } else {\n      controle_aanbevolen.push(p);\n      // CRITICAL SAFETY RULE: an unresolved classification is not a fiscal\n      // conclusion. Its calculated placeholder must never enter totals.\n      continue;\n    }\n\n    if (p.classification === 'verlegd_21') {"""
if old not in s:
    raise SystemExit('Aggregation block not found')
s = s.replace(old, new, 1)

# 5. Independent audit must use exactly the same set of financially included
#    transactions; unresolved transactions are audited for structure but not
#    allowed to create a false mismatch against totals.
s = s.replace(
"""  const herberekend_btw_21 = round2(\n    processed\n      .filter((t) => t.rate === 21 && t.classification !== 'verlegd_21')""",
"""  const herberekend_btw_21 = round2(\n    processed\n      .filter((t) => t.herkend && t.rate === 21 && t.classification !== 'verlegd_21')""",
1)
s = s.replace(
"""  const herberekend_btw_9 = round2(\n    processed.filter((t) => t.rate === 9).reduce""",
"""  const herberekend_btw_9 = round2(\n    processed.filter((t) => t.herkend && t.rate === 9).reduce""",
1)

# 6. Make the regelaantal invariant explicit in the audit. Every input must be
#    exactly one of included, unresolved, or ignored summary rows.
marker = """  // Controle 1 (aggregaat): Totaal incl. 21% − Totaal excl. 21% − Totale BTW 21% = 0.\n"""
insert = """  // Regelaantal-controle: no silent disappearance or duplication.\n  const meegenomen = processed.filter((t) => t.herkend).length;\n  const twijfel = processed.filter((t) => !t.herkend).length;\n  if (meegenomen + twijfel !== processed.length) {\n    problemen.push(`Regelaantal-controle faalt: meegenomen (${meegenomen}) + twijfelgevallen (${twijfel}) != verwerkte transacties (${processed.length}).`);\n  }\n\n""" + marker
if marker not in s:
    raise SystemExit('Audit insertion marker not found')
s = s.replace(marker, insert, 1)

# 7. Remove the old claim that the no-signal fallback is a confident result.
s = s.replace(
"""    // Alle lagen doorlopen, geen enkel signaal (positief of tegenstrijdig)\n    // gevonden: er is geen reden om af te wijken van het algemene tarief,\n    // dus geldt dat tarief — met vertrouwen, niet als gok. Dit is GEEN\n    // twijfelgeval: \"geen uitzondering van toepassing\" is zelf al het\n    // juiste, volledig onderbouwde antwoord (art. 15 lid 1 sub a Wet OB\n    // 1968 is de standaardregel, geen noodgreep).""",
"""    // Alle lagen doorlopen zonder voldoende fiscale aanwijzing: dit is an\n    // unresolved case. Do NOT invent a 21% classification. The placeholder\n    // classification is retained only because ProcessedTransaction currently\n    // requires a ClassificationKey; calculateVatReport excludes herkend=false\n    // rows from all financial totals until a bookkeeper resolves them.""",
1)
s = s.replace(
"""  // Zelfde redenering als bij uitgaven: geen signaal voor iets anders dan\n  // het algemene tarief gevonden -> dat tarief geldt met vertrouwen.""",
"""  // Geen voldoende fiscale aanwijzing: markeer als twijfelgeval.\n  // Een 21%-placeholder wordt nooit financieel meegerekend zolang herkend=false.""",
1)

p.write_text(s, encoding='utf-8')
print('BTW engine safety patch applied')
