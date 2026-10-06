import React from 'react';
import { InvoiceLineItem } from '../types';
import { Plus, Trash2, Copy } from 'lucide-react';

interface LineItemsEditorProps {
  items: InvoiceLineItem[];
  currencySymbol: string;
  onChange: (updatedItems: InvoiceLineItem[]) => void;
}

export const LineItemsEditor: React.FC<LineItemsEditorProps> = ({
  items,
  currencySymbol,
  onChange,
}) => {
  const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

  const parseNum = (val: any, fallback = 0): number => {
    if (val === null || val === undefined || val === '') return fallback;
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  };

  const handleItemChange = (index: number, field: keyof InvoiceLineItem, value: any) => {
    const nextItems = [...items];
    const item = { ...nextItems[index], [field]: value };

    // Auto-calculate line total if qty, unit price, discount, or tax percent changes
    if (
      field === 'quantity' ||
      field === 'unit_price' ||
      field === 'discount' ||
      field === 'tax_rate_percent'
    ) {
      const qty = parseNum(item.quantity, 1);
      const price = parseNum(item.unit_price, 0);
      const disc = parseNum(item.discount, 0);
      const taxRate = parseNum(item.tax_rate_percent, 0);

      const baseAmount = Math.max(0, qty * price - disc);
      const taxAmt = (baseAmount * taxRate) / 100;

      item.tax_amount = round2(taxAmt);
      item.line_total = round2(baseAmount + taxAmt);
    } else if (field === 'line_total') {
      item.line_total = parseNum(value, 0);
    }

    nextItems[index] = item;
    onChange(nextItems);
  };

  const handleAddItem = () => {
    const newItem: InvoiceLineItem = {
      item_id: `item-${items.length + 1}`,
      description: 'New Line Item / Service',
      hsn_sac: '',
      quantity: 1,
      unit: 'pcs',
      unit_price: 0,
      discount: 0,
      tax_rate_percent: 0,
      tax_amount: 0,
      line_total: 0,
      confidence: 1.0,
      is_reviewed: true,
    };
    onChange([...items, newItem]);
  };

  const handleDeleteItem = (index: number) => {
    const nextItems = items.filter((_, i) => i !== index);
    onChange(nextItems);
  };

  const handleDuplicateItem = (index: number) => {
    const target = items[index];
    const cloned: InvoiceLineItem = {
      ...target,
      item_id: `item-${items.length + 1}`,
      description: `${target.description} (Copy)`,
    };
    const nextItems = [...items];
    nextItems.splice(index + 1, 0, cloned);
    onChange(nextItems);
  };

  const totalCalculated = items.reduce((sum, item) => sum + (item.line_total ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Itemized Line Details ({items.length})
          </h3>
          <span className="text-[11px] text-slate-500">
            • Editable table with live line total recalculation
          </span>
        </div>
        <button
          type="button"
          onClick={handleAddItem}
          className="px-2.5 py-1 text-xs font-semibold text-blue-600 bg-[#EFF6FF] hover:bg-blue-100 border border-blue-200 rounded transition flex items-center gap-1 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Line Item
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[960px] text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold text-[11px] uppercase tracking-wider">
              <th className="py-2.5 px-3 w-10 text-center">#</th>
              <th className="py-2.5 px-3 min-w-[220px]">Description</th>
              <th className="py-2.5 px-3 min-w-[120px] w-32">HSN / SAC</th>
              <th className="py-2.5 px-3 min-w-[100px] w-28 text-right">Qty</th>
              <th className="py-2.5 px-3 min-w-[95px] w-24">Unit</th>
              <th className="py-2.5 px-3 min-w-[120px] w-32 text-right">Rate ({currencySymbol})</th>
              <th className="py-2.5 px-3 min-w-[110px] w-28 text-right">Disc ({currencySymbol})</th>
              <th className="py-2.5 px-3 min-w-[95px] w-24 text-right">Tax %</th>
              <th className="py-2.5 px-3 min-w-[130px] w-36 text-right">Total ({currencySymbol})</th>
              <th className="py-2.5 px-3 min-w-[80px] w-20 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {items.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-6 text-center text-slate-400">
                  No line items extracted. Click "Add Line Item" to enter items manually.
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr key={item.item_id || idx} className="hover:bg-slate-50 transition group">
                  <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                    {idx + 1}
                  </td>
                  {/* Description */}
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={item.description || ''}
                      onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-slate-800 outline-none"
                      placeholder="Item description"
                    />
                  </td>
                  {/* HSN/SAC */}
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={item.hsn_sac || ''}
                      onChange={(e) => handleItemChange(idx, 'hsn_sac', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-slate-800 font-mono outline-none"
                      placeholder="—"
                    />
                  </td>
                  {/* Qty */}
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="any"
                      value={item.quantity ?? ''}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-right text-slate-800 font-mono outline-none"
                      placeholder="1"
                    />
                  </td>
                  {/* Unit */}
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={item.unit || ''}
                      onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-slate-600 outline-none"
                      placeholder="pcs"
                    />
                  </td>
                  {/* Rate / Unit Price */}
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="any"
                      value={item.unit_price ?? ''}
                      onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-right text-slate-800 font-mono outline-none"
                      placeholder="0.00"
                    />
                  </td>
                  {/* Discount */}
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="any"
                      value={item.discount ?? ''}
                      onChange={(e) => handleItemChange(idx, 'discount', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-right text-slate-800 font-mono outline-none"
                      placeholder="0.00"
                    />
                  </td>
                  {/* Tax Rate % */}
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="any"
                      value={item.tax_rate_percent ?? ''}
                      onChange={(e) => handleItemChange(idx, 'tax_rate_percent', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-right text-slate-800 font-mono outline-none"
                      placeholder="0%"
                    />
                  </td>
                  {/* Line Total */}
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      step="any"
                      value={item.line_total ?? ''}
                      onChange={(e) => handleItemChange(idx, 'line_total', e.target.value)}
                      className="w-full bg-white border border-slate-200 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 rounded px-2.5 py-1.5 text-xs text-right font-bold text-slate-900 font-mono outline-none"
                      placeholder="0.00"
                    />
                  </td>
                  {/* Actions */}
                  <td className="py-2 px-3 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-70 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => handleDuplicateItem(idx)}
                        className="p-1 text-slate-400 hover:text-slate-950 rounded hover:bg-slate-100 transition"
                        title="Duplicate row"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(idx)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 transition"
                        title="Delete row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 text-slate-800 border-t border-slate-200 font-bold">
                <td colSpan={8} className="py-2.5 px-3 text-right text-xs uppercase tracking-wider text-slate-500">
                  Total of Line Items ({items.length} items):
                </td>
                <td className="py-2.5 px-3 text-right text-sm font-mono text-slate-900">
                  {currencySymbol}{totalCalculated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

