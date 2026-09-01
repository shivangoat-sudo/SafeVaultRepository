# Dutch VAT reference cases

These fixtures are reference cases for the safe VAT engine. They are deliberately explicit: a bank CSV alone cannot prove every fiscal fact.

## Case A — Dutch domestic sales
- €121 gross at 21% => €100 base, €21 output VAT.
- €109 gross at 9% => €100 base, €9 output VAT.

## Case B — Dutch business purchases
- €121 gross at 21% => €100 base, €21 input VAT, deductible only if invoice/conditions support deduction.
- €109 gross at 9% => €100 base, €9 input VAT, same evidence condition.

## Case C — restaurant / BUA
A restaurant transaction must not be automatically treated as ordinary deductible input VAT. The system must expose the VAT as non-deductible/needs review according to the applicable BUA rules rather than silently deduct it.

## Case D — EU supplier service, VAT reverse-charged to Dutch business
If the transaction is an EU acquisition/service for which Dutch VAT is reverse-charged, the taxable base is the invoice amount excluding VAT. For €100 base at 21%: €21 output VAT and, if used for taxable activities and otherwise deductible, €21 input VAT. This belongs in the appropriate foreign section (for an EU service normally 4b), not automatically domestic reverse charge 2a.

## Case E — non-EU supplier service
For a service from a non-EU supplier where VAT is reverse-charged to the Netherlands, the transaction belongs in the applicable non-EU foreign section (4a). The VAT may also be deductible as input VAT when the legal conditions are met.

## Case F — 0% versus exempt
0% taxable supplies and VAT-exempt supplies must be separate classifications. They are not interchangeable because exemption can affect input VAT recovery/pro-rata allocation.

## Case G — ambiguous bank line
An unknown Af/Bij value, unknown VAT status, or insufficient evidence must not silently become a fiscal classification. It must remain unresolved and outside financial VAT totals until resolved.

## Case H — summary rows
Rows such as TOTAAL, SUBTOTAAL, BTW TOTAAL, or period summaries must never be counted as transactions.
