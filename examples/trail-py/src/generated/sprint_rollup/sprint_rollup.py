from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any
from src.db import db

class SprintRollup(BaseModel):
    sprint_id: int
    total_issues: int  #phx:R1
    total_points: int  #phx:R1
    completed_points: int  #phx:R1
    points_remaining: int  #phx:R1
    percentage_completed: float  #phx:R1
    issues_by_status: Dict[str, int]  #phx:R2
    over_capacity: bool  #phx:R3
    capacity_exceeded_by: Optional[int]  #phx:R3

router = APIRouter()

@router.get("/{sprint_id}")
def get_sprint_rollup(sprint_id: int) -> SprintRollup:
    # Get sprint info
    sprint_row = db.execute("SELECT capacity FROM sprint WHERE id = ?", (sprint_id,)).fetchone()
    if sprint_row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Sprint not found")
    
    sprint_capacity = sprint_row[0] or 0
    
    # Get all issues for this sprint
    issue_rows = db.execute("""
        SELECT status, point_estimate 
        FROM issue 
        WHERE sprint_id = ?
    """, (sprint_id,)).fetchall()
    
    # Calculate totals
    total_issues = len(issue_rows)  #phx:R1
    total_points = sum(row[1] or 0 for row in issue_rows)  #phx:R1
    completed_points = sum(row[1] or 0 for row in issue_rows if row[0] == 'done')  #phx:R1
    points_remaining = total_points - completed_points  #phx:R1
    percentage_completed = (completed_points / total_points * 100) if total_points > 0 else 0.0  #phx:R1
    
    # Count issues by status
    issues_by_status = {  #phx:R2
        'backlog': 0,
        'todo': 0,
        'inprogress': 0,
        'inreview': 0,
        'done': 0
    }
    
    for row in issue_rows:
        status = row[0]
        if status in issues_by_status:
            issues_by_status[status] += 1  #phx:R2
    
    # Check capacity
    over_capacity = total_points > sprint_capacity  #phx:R3
    capacity_exceeded_by = total_points - sprint_capacity if over_capacity else None  #phx:R3
    
    return SprintRollup(
        sprint_id=sprint_id,
        total_issues=total_issues,
        total_points=total_points,
        completed_points=completed_points,
        points_remaining=points_remaining,
        percentage_completed=percentage_completed,
        issues_by_status=issues_by_status,
        over_capacity=over_capacity,
        capacity_exceeded_by=capacity_exceeded_by
    )

# @internal Phoenix VCS traceability — do not remove.
_phoenix = {
    "iu_id": "d31fdeda9f3255eccc6401c9c8de506f24eb6d924b1dc7926ffb1d9a203f7af1",
    "name": "sprint rollup",
    "risk_tier": "low",
    "canon_ids": 3,
}
