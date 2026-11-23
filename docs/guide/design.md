# Design labels

A **template** is the design. A **label** fills in its fields. One template can
have hundreds of labels, and editing it updates them all.

## Start a label

![The new label dialog](/screens/new-label-light.png)

**New label** asks which design to use. Pick an existing one to fill in its
fields, or start a **new design**, which opens the editor. More starting points
are under **Templates > New from gallery**.

## The editor

![The template editor with the Label Muncher open](/screens/editor-light.png)

- **Layers** (left): everything on the label. Drag to reorder, or into a group.
- **Canvas** (middle): drag to move, drag corners to resize. Arrow keys nudge by
  one printer dot, <kbd>Shift</kbd> + arrow by 1 mm.
- **Properties** (right): the selected element, the template, its fields, and
  per-size variants.
- **Sizes** (bottom): the same design on other label sizes, live.

Press <kbd>?</kbd> for all keyboard shortcuts.

## Make it fit every size

Groups lay out their contents as a **row**, a **column** or **freely**. Each
element's width and height can be:

| Sizing | Means |
| --- | --- |
| Fixed | Always this many millimetres |
| Hug | Just big enough for its contents |
| Fill | Takes the space that is left |

Text can shrink to fit, or grow to fill its box. When a size needs something
different, add a **variant**: for example, hide the barcode on labels under
20 mm wide.

## Fields and automatic values

Write a field name in double braces and each label fills it in:

```
{{title}}
Made {{date}}, use by {{date+30d:DD MMM}}
Box {{counter:box:0000}}
```

**Insert field** lists what you can use, including team-wide values such as your
company name. The full list is in [Template text](/templates).

## Codes, icons and pictures

- **Codes**: QR, Data Matrix, Code 128, EAN/UPC, GS1, postal codes and more. They
  are drawn at whole printer dots so they scan.
- **Icons**: several thousand from open icon sets, plus your own SVGs. Type a
  word to search.
- **Pictures**: dithered for one-colour printing, with several styles to choose.
- **Fonts**: upload your own. Pixel fonts are detected and kept crisp.

## Share designs

Export a template or a folder as a [pack](/packs), keep packs in a GitHub repo,
and other people get your updates.

## See it on the object

![A label mocked up on a parts drawer](/screens/mockups-light.png)

**Mockups** show labels at true size on a drawer, box, bag or cable, on the stock
and ribbon you chose. Download the picture for a listing or a document.
