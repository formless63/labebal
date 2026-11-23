# Labels from data

![A table of parts with a label previewed for each row](/screens/data-light.png)

The **Data** page keeps tables of records, such as drawer contents, stock or
products, and turns each row into a label.

## Bring in rows

- Import a CSV, Excel or OpenDocument file.
- Paste from a spreadsheet.
- Follow a **live source**: a Google Sheet, a CSV link or a JSON API, synced on a
  schedule.
- Push rows from another system with the [REST API](/rest).

Choose a **key column** (such as a part number) and importing again updates the
same rows instead of adding copies.

## Turn rows into labels

1. On **Label design**, pick a template and match its fields to your columns.
2. On **Rules**, change the look by what is in the row: for example, when
   *Category* is *Nuts*, use the nut icon.
3. On **Preview**, check the result for every row.
4. Click **Create / update labels**, or **Add all to print queue**.

Labels stay linked to their rows, so a change in the data updates the label.

## Let other systems ask for labels

Create a token in **Settings > API access**, then:

- push labels and rows,
- reserve numbers from a counter so nothing is ever used twice,
- ask for a print. It waits in the **Inbox** until someone at a browser approves it.

Webhooks tell your systems when something is printed, approved or voided. See the
[REST API guide](/api).
