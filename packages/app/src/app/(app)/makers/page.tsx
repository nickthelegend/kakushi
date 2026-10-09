import { redirect } from "next/navigation";

/** The Makers page is now the Market. */
export default function MakersPage() {
  redirect("/market");
}
