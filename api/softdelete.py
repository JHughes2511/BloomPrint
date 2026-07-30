"""Soft delete: deleting hides a record, it never destroys it.

A coach deleting an evaluation or a game means "get this out of my way", not
"erase the film session I spent an hour on". Rows are stamped with `deleted_at`
and disappear from the app, but the data is still there to recover.

Filtering is applied once, globally, rather than by adding `.filter(deleted_at
is None)` to every query. There are hundreds of reads across the routes and
prompt builders; the one that gets forgotten is the one that resurrects a
deleted report inside an AI prompt weeks later, where nobody would think to
look for it. A single criterion applied to every SELECT can't be forgotten.

To read deleted rows on purpose (a restore path, an audit), pass the
`include_deleted` execution option:

    db.query(models.Evaluation).execution_options(include_deleted=True).all()
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, event
from sqlalchemy.orm import Session, with_loader_criteria


class SoftDeleteMixin:
    """Marks a model as hidden-not-destroyed on delete.

    Every model carrying this mixin is covered by the global filter below, so
    adding the mixin is the whole opt-in — no per-query changes needed.
    """
    deleted_at = Column(DateTime, nullable=True, index=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


def soft_delete(db: Session, row) -> None:
    """Hide a record. Safe to call twice — the original timestamp is kept."""
    if row is None:
        return
    if getattr(row, "deleted_at", None) is None:
        row.deleted_at = datetime.utcnow()


def restore(db: Session, row) -> None:
    """Bring a hidden record back."""
    if row is not None:
        row.deleted_at = None


@event.listens_for(Session, "do_orm_execute")
def _hide_soft_deleted(execute_state):
    """Exclude soft-deleted rows from every ORM SELECT.

    Naming the mixin as the target applies the criterion to every model that
    carries it, so adding a new soft-deletable model needs no change here.

    Column loads are skipped: that's a deferred attribute on a row already in
    memory, so the row was fetched legitimately and re-filtering it would fail
    the load rather than hide anything.

    Relationship loads are NOT skipped. Propagation only covers loaders reached
    from a query that carried the option, which a lazily-loaded collection
    often isn't — tested, and without this a deleted player's evaluations still
    came back through `player.evaluations`. That is exactly the path that would
    feed a deleted report into an AI prompt.
    """
    if (
        not execute_state.is_select
        or execute_state.is_column_load
        or execute_state.execution_options.get("include_deleted", False)
    ):
        return
    execute_state.statement = execute_state.statement.options(
        with_loader_criteria(
            SoftDeleteMixin,
            lambda cls: cls.deleted_at.is_(None),
            include_aliases=True,
        )
    )
