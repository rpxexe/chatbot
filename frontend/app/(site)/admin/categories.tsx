"use client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2 } from "lucide-react";
import { RowAction } from "./ui";
import { api, type Category, type Token } from "./api";

type Props = { token: Token; categories: Category[]; onChange: () => void; onError: (e: unknown) => void };

export function CategoriesPanel({ token, categories, onChange, onError }: Props) {
  async function rename(c: Category) {
    const name = prompt(`Rename "${c.name}" to:`, c.name)?.trim();
    if (!name || name === c.name) return;
    try { await api(token, `/categories/${c.id}`, "PATCH", { name }); toast.success(`Renamed to “${name}”`); onChange(); } catch (e) { onError(e); }
  }
  async function remove(c: Category) {
    if (!confirm(`Delete category "${c.name}"? Its ${c.faq_count} FAQs and ${c.document_count} documents stay, uncategorised.`)) return;
    try { await api(token, `/categories/${c.id}`, "DELETE"); toast.success(`Category “${c.name}” deleted`); onChange(); } catch (e) { onError(e); }
  }

  if (categories.length === 0) return <p className="text-muted-foreground">No categories yet. Type a category name when adding a FAQ or document to create one.</p>;
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Category</TableHead><TableHead>FAQs</TableHead><TableHead>Documents</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.name}</TableCell>
              <TableCell>{c.faq_count}</TableCell>
              <TableCell>{c.document_count}</TableCell>
              <TableCell className="flex justify-end gap-2">
                <RowAction icon={Pencil} label="Rename" onClick={() => rename(c)} />
                <RowAction icon={Trash2} label="Delete" danger onClick={() => remove(c)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
