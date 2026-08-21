# Library Loans

A lending service for a small library. It tracks members, the books the library owns,
and the loans between them. Other systems drive it over HTTP.

## Members

- A member has a name, an email address, and the date they joined
- Every member must have a stable unique integer identifier that external systems can reference
- Users can register a member by providing a name and an email address
- A member's name must not be empty and must not exceed 120 characters
- A member's email address must contain an `@` and must not be empty
- Two members must never share the same email address; a registration that repeats an existing
  email is a conflict, not a validation error
- Users can list every member
- Users can read a single member, including how many loans that member currently has out
- Users can remove a member only when that member has no active loan; removing a member who still
  has one is a conflict
- Removing a member must never delete that member's returned loan history

## Books

- A book has a title, an author, an ISBN, and a count of how many copies the library owns
- Every book must have a stable unique integer identifier that external systems can reference
- Users can add a book by providing a title, an author, an ISBN, and a copy count
- A book's title and author must not be empty
- Two books must never share the same ISBN; a repeat is a conflict, not a validation error
- The copy count must be a whole number of at least 1
- Users can list every book
- Users can read a single book, including how many of its copies are currently available
- The available count is the number of copies the library owns minus the number of copies
  currently out on loan, and it must never be negative
- Users can list only the books that have at least one copy available

## Loans

- A loan records which book was borrowed, which member borrowed it, when it was borrowed, when
  it is due back, and when it was returned
- Every loan must have a stable unique integer identifier
- Users can borrow a book by naming an existing book and an existing member
- Borrowing a book that does not exist, or naming a member who does not exist, is a not-found error
- A loan is due 14 days after it is borrowed
- A book with no available copies cannot be borrowed; that is a conflict
- A member may have at most 3 active loans at once; a fourth is a conflict
- An active loan is one that has not been returned
- Users can return a loan; returning it records when it came back and makes the copy available again
- Returning a loan that has already been returned is a conflict
- Returning a loan that does not exist is a not-found error
- Users can list every loan, and can list only the active ones

## Summary

- Users can read a summary of the library: how many members are registered, how many distinct books
  the library holds, how many copies are currently on loan, and how many loans are active
- The summary must reflect every change immediately

## HTTP interface

The service exposes exactly these routes, and answers JSON on all of them:

- `GET /health` — returns 200 once the service is ready
- `POST /members` — registers a member; returns 201 and the created member
- `GET /members` — returns 200 and a JSON array of members
- `GET /members/:id` — returns 200 and the member, or 404
- `DELETE /members/:id` — returns 204, 404 if there is no such member, or 409 if they hold an active loan
- `POST /books` — adds a book; returns 201 and the created book
- `GET /books` — returns 200 and a JSON array of books; `GET /books?available=true` returns only
  books with at least one copy available
- `GET /books/:id` — returns 200 and the book, or 404
- `POST /loans` — borrows a book from a JSON body of `{ "book_id": n, "member_id": n }`; returns 201
  and the created loan
- `GET /loans` — returns 200 and a JSON array of loans; `GET /loans?active=true` returns only loans
  that have not been returned
- `POST /loans/:id/return` — returns 200 and the returned loan
- `GET /summary` — returns 200 and
  `{ "members": n, "books": n, "copies_on_loan": n, "active_loans": n }`

Status codes carry meaning and are part of the contract:

- 400 — the body is malformed or a field is invalid
- 404 — a named member, book or loan does not exist
- 409 — the request was well formed and the library's rules forbid it: a duplicate email, a duplicate
  ISBN, a book with no copies available, a member already holding 3 loans, a loan returned twice, or
  removing a member who still holds one

In every response:

- a member is `{ id, name, email, joined_at, active_loans }` where `active_loans` is an integer
- a book is `{ id, title, author, isbn, copies_total, copies_available }` where both counts are integers
- a loan is `{ id, book_id, member_id, borrowed_at, due_at, returned_at }` where `returned_at` is
  `null` until the loan comes back
