from pathlib import Path

p = Path('src/lib/btwEngine.ts')
s = p.read_text(encoding='utf-8')

# Make unresolved classification explicit in the source metadata.
old = "  | 'handmatig_percentage';         // boekhouder heeft, als laatste redmiddel, alleen het BTW-percentage aangewezen (percentageOverrides)"
new = "  | 'handmatig_percentage'         // boekhouder heeft, als laatste redmiddel, alleen het BTW-percentage aangewezen (percentageOverrides)\n  | 'twijfel_onvoldoende_informatie'; // onvoldoende informatie; nooit als automatische fiscale conclusie gebruiken"
if old not in s:
    raise SystemExit('classification union anchor not found')
s = s.replace(old, new, 1)

# Unknown automatic cases must be unresolved, not confident 21% cases.
old = """    return {\n      classification: 'kosten_algemeen_21',\n      herkend: true,\n      herkenningsbron:\n        'Geen leverancier, trefwoord, categorie of IBAN-signaal wijst op een verlaagd tarief, vrijstelling of verlegging — het algemene tarief van 21% is dan het fiscaal juiste standaardantwoord.',\n      bron: 'standaard_geen_uitzondering',\n      zekerheid: 'hoog',\n    };"""
new = """    return {\n      classification: 'kosten_algemeen_21',\n      herkend: false,\n      herkenningsbron:\n        'Onvoldoende fiscale informatie om deze uitgave betrouwbaar te classificeren. De engine gokt niet op 21%; deze transactie moet handmatig worden beoordeeld.',\n      bron: 'twijfel_onvoldoende_informatie',\n      zekerheid: 'laag',\n    };"""
if old not in s:
    raise SystemExit('expense fallback anchor not found')
s = s.replace(old, new, 1)

old = """  return {\n    classification: 'omzet_algemeen_21',\n    herkend: true,\n    herkenningsbron:\n      'Geen trefwoord of categorie wijst op een verlaagd tarief of vrijstelling — het algemene tarief van 21% is dan het fiscaal juiste standaardantwoord voor binnenlandse B2B-dienstverlening.',\n    bron: 'standaard_geen_uitzondering',\n    zekerheid: 'hoog',\n  };"""
new = """  return {\n    classification: 'omzet_algemeen_21',\n    herkend: false,\n    herkenningsbron:\n      'Onvoldoende fiscale informatie om deze ontvangst betrouwbaar te classificeren. De engine gokt niet op 21%; deze transactie moet handmatig worden beoordeeld.',\n    bron: 'twijfel_onvoldoende_informatie',\n    zekerheid: 'laag',\n  };"""
if old not in s:
    raise SystemExit('income fallback anchor not found')
s = s.replace(old, new, 1)

# The current aggregation must exclude unresolved classifications entirely.
old = """    if (p.herkend) {\n      automatisch_herkend += 1;\n    } else {\n      controle_aanbevolen.push(p);\n    }\n\n    if (p.classification === 'verlegd_21') {"""
new = """    if (p.herkend) {\n      automatisch_herkend += 1;\n    } else {\n      controle_aanbevolen.push(p);\n      // SAFETY: unresolved classifications are never fiscal conclusions.\n      // They remain visible for review but cannot alter any financial total.\n      continue;\n    }\n\n    if (p.classification === 'verlegd_21') {"""
if old not in s:
    raise SystemExit('aggregation anchor not found')
s = s.replace(old, new, 1)

# AI disagreement must not silently become a financial 21% result. The existing
# code routes disagreement through auto.classification; after the fallback fix
# that is unresolved, but make the intent explicit in the comments.
s = s.replace(
"""      // Geen meerderheid en geen boekhouder-override: automatisch terugvallen op de fiscaal veilige standaard, zonder dat er ooit een vraag aan de gebruiker wordt gesteld.""",
"""      // Geen meerderheid en geen boekhouder-override: dit blijft een twijfelgeval.\n      // Een AI-minderheid/verdeelde uitkomst is geen fiscale grond om te gokken.""",
1)
s = s.replace(
"""    // Alle lagen (regels, memo, gecombineerde signalen, brede categorieën, AI)\n    // zijn doorzocht en er is geen boekhouder-override — pas nu wordt de\n    // veilige standaard toegepast.""",
"""    // Alle lagen (regels, memo, gecombineerde signalen, brede categorieën, AI)\n    // zijn doorzocht en er is geen boekhouder-override. De transactie blijft\n    // een twijfelgeval en mag niet financieel worden meegenomen.""",
1)

# Independent checks must use only financially included rows.
s = s.replace(
".filter((t) => t.rate === 21 && t.classification !== 'verlegd_21')",
".filter((t) => t.herkend && t.rate === 21 && t.classification !== 'verlegd_21')",
1)
s = s.replace(
"processed.filter((t) => t.rate === 9).reduce",
"processed.filter((t) => t.herkend && t.rate === 9).reduce",
1)

# Add a strict accounting invariant: every processed row is either recognized
# and included, or unresolved and excluded. No third silent state is allowed.
anchor = """  // Controle 1 (aggregaat): Totaal incl. 21% − Totaal excl. 21% − Totale BTW 21% = 0.\n"""
insert = """  const financieelMeegeteld = processed.filter((t) => t.herkend).length;\n  const onopgelost = processed.filter((t) => !t.herkend).length;\n  if (financieelMeegeteld + onopgelost !== processed.length) {\n    problemen.push(`Regelaantal-controle faalt: meegeteld (${financieelMeegeteld}) + onopgelost (${onopgelost}) != verwerkt (${processed.length}).`);\n  }\n\n""" + anchor
if anchor not in s:
    raise SystemExit('audit anchor not found')
s = s.replace(anchor, insert, 1)

p.write_text(s, encoding='utf-8')
print('Applied structural BTW safety changes')
