from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from src.db import db

class CreateSprint(BaseModel):
    name: str = Field(min_length=1, max_length=80)  #phx:C1,C2
    goal: Optional[str] = Field(default="", max_length=280)  #phx:C3
    start_date: str  #phx:R2,C4
    end_date: str  #phx:R2,C4
    capacity: Optional[int] = None  #phx:R3


class UpdateSprint(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)  #phx:C1,C2
    goal: Optional[str] = Field(default=None, max_length=280)  #phx:C3
    start_date: Optional[str] = None  #phx:C4
    end_date: Optional[str] = None  #phx:C4
    capacity: Optional[int] = None  #phx:R3
    is_current: Optional[bool] = None
    is_closed: Optional[bool] = None


router = APIRouter()


def validate_dates(start_date: str, end_date: str):
    try:
        # Validate date format by attempting to parse
        db.execute("SELECT date(?)", (start_date,)).fetchone()
        db.execute("SELECT date(?)", (end_date,)).fetchone()
        
        # Check that end_date is not before start_date
        result = db.execute("SELECT date(?) < date(?)", (end_date, start_date)).fetchone()
        if result[0]:
            raise HTTPException(status_code=400, detail="End date cannot be before start date")  #phx:C4
    except:
        raise HTTPException(status_code=400, detail="Invalid date format")  #phx:C4


def validate_capacity(capacity: Optional[int]):
    if capacity is not None and capacity <= 0:
        raise HTTPException(status_code=400, detail="Capacity must be a positive whole number")  #phx:R3


@router.get("/")
def list_sprints():
    rows = db.execute("""
        SELECT * FROM sprints 
        ORDER BY is_closed ASC, start_date DESC
    """).fetchall()
    return [dict(r) for r in rows]


@router.post("/", status_code=201)
def create_sprint(payload: CreateSprint):  #phx:R2
    validate_dates(payload.start_date, payload.end_date)
    validate_capacity(payload.capacity)
    
    cur = db.execute("""
        INSERT INTO sprints (name, goal, start_date, end_date, capacity) 
        VALUES (?, ?, ?, ?, ?)
    """, (payload.name, payload.goal or "", payload.start_date, payload.end_date, payload.capacity))
    db.commit()
    
    row = db.execute("SELECT * FROM sprints WHERE id = ?", (cur.lastrowid,)).fetchone()  #phx:R1
    return dict(row)


@router.get("/{sprint_id}")
def get_sprint(sprint_id: int):
    row = db.execute("SELECT * FROM sprints WHERE id = ?", (sprint_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return dict(row)


@router.patch("/{sprint_id}")
def update_sprint(sprint_id: int, payload: UpdateSprint):
    row = db.execute("SELECT * FROM sprints WHERE id = ?", (sprint_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    
    # Validate dates if both are provided or if updating one with existing other
    start_date = payload.start_date if payload.start_date is not None else row['start_date']
    end_date = payload.end_date if payload.end_date is not None else row['end_date']
    if payload.start_date is not None or payload.end_date is not None:
        validate_dates(start_date, end_date)
    
    if payload.capacity is not None:
        validate_capacity(payload.capacity)
    
    # Handle current sprint logic - only one can be current
    if payload.is_current is True:
        db.execute("UPDATE sprints SET is_current = 0")
    
    # Update fields
    if payload.name is not None:
        db.execute("UPDATE sprints SET name = ?, updated_at = datetime('now') WHERE id = ?", (payload.name, sprint_id))
    if payload.goal is not None:
        db.execute("UPDATE sprints SET goal = ?, updated_at = datetime('now') WHERE id = ?", (payload.goal, sprint_id))
    if payload.start_date is not None:
        db.execute("UPDATE sprints SET start_date = ?, updated_at = datetime('now') WHERE id = ?", (payload.start_date, sprint_id))
    if payload.end_date is not None:
        db.execute("UPDATE sprints SET end_date = ?, updated_at = datetime('now') WHERE id = ?", (payload.end_date, sprint_id))
    if payload.capacity is not None:
        db.execute("UPDATE sprints SET capacity = ?, updated_at = datetime('now') WHERE id = ?", (payload.capacity, sprint_id))
    if payload.is_current is not None:
        db.execute("UPDATE sprints SET is_current = ?, updated_at = datetime('now') WHERE id = ?", (1 if payload.is_current else 0, sprint_id))
    if payload.is_closed is not None:
        db.execute("UPDATE sprints SET is_closed = ?, updated_at = datetime('now') WHERE id = ?", (1 if payload.is_closed else 0, sprint_id))
    
    db.commit()
    
    row = db.execute("SELECT * FROM sprints WHERE id = ?", (sprint_id,)).fetchone()
    return dict(row)


@router.delete("/{sprint_id}", status_code=204)
def delete_sprint(sprint_id: int):
    if db.execute("SELECT id FROM sprints WHERE id = ?", (sprint_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    
    # Check if any issues are attached to this sprint
    issue_count = db.execute("SELECT COUNT(*) FROM issues WHERE sprint_id = ?", (sprint_id,)).fetchone()[0]
    if issue_count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete sprint with attached issues")  #phx:R5
    
    db.execute("DELETE FROM sprints WHERE id = ?", (sprint_id,))
    db.commit()

# @internal Phoenix VCS traceability — do not remove.
_phoenix = {
    "iu_id": "71cccbcf51d41c225a0178f08d565f45ff1ba67766412db0f5fe682d56771d28",
    "name": "sprint",
    "risk_tier": "high",
    "canon_ids": 9,
}
