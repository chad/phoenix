from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from src.db import db

class CreateIssue(BaseModel):
    title: str = Field(min_length=1, max_length=200)  #phx:C1,C2,C3
    description: Optional[str] = Field(default="", max_length=5000)  #phx:C4
    priority: Literal['urgent', 'high', 'normal', 'low'] = 'normal'  #phx:C1,I1
    point_estimate: Optional[Literal[1, 2, 3, 5, 8, 13]] = None  #phx:R4
    assignee: Optional[str] = None
    labels: Optional[List[str]] = None  #phx:C6
    sprint_id: Optional[int] = None


class UpdateIssue(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)  #phx:C2,C3
    description: Optional[str] = Field(default=None, max_length=5000)  #phx:C4
    status: Optional[Literal['backlog', 'todo', 'inprogress', 'inreview', 'done']] = None  #phx:I2
    priority: Optional[Literal['urgent', 'high', 'normal', 'low']] = None  #phx:I1
    point_estimate: Optional[Literal[1, 2, 3, 5, 8, 13]] = None  #phx:R4
    assignee: Optional[str] = None
    labels: Optional[List[str]] = None  #phx:C6
    sprint_id: Optional[int] = None


router = APIRouter()


def validate_labels(labels: List[str]) -> str:
    if len(labels) > 8:  #phx:C6
        raise HTTPException(status_code=400, detail="Issue cannot have more than 8 labels")
    if len(set(labels)) != len(labels):  #phx:C6
        raise HTTPException(status_code=400, detail="Issue cannot have duplicate labels")
    for label in labels:
        if len(label) > 24:  #phx:C6
            raise HTTPException(status_code=400, detail="Label cannot exceed 24 characters")
    return ",".join(labels)


def validate_status_transition(current_status: str, new_status: str):  #phx:R5
    if current_status == new_status:
        return
    
    status_order = ['backlog', 'todo', 'inprogress', 'inreview', 'done']
    current_idx = status_order.index(current_status)
    new_idx = status_order.index(new_status)
    
    # Can move one step forward or backward, or directly back to backlog
    if new_status == 'backlog':
        return
    if abs(new_idx - current_idx) == 1:
        return
    
    raise HTTPException(status_code=400, detail="Invalid status transition")


def validate_backlog_exit(current_status: str, new_status: str, point_estimate: Optional[int]):  #phx:C5
    if current_status == 'backlog' and new_status != 'backlog' and point_estimate is None:
        raise HTTPException(status_code=400, detail="Cannot move issue out of backlog without point estimate")


@router.get("/")
def list_issues(assignee: Optional[str] = None, label: Optional[str] = None, search: Optional[str] = None, sprint_id: Optional[int] = None):  #phx:R6
    query = "SELECT * FROM issues WHERE 1=1"
    params = []
    
    if assignee:
        query += " AND assignee = ?"
        params.append(assignee)
    
    if label:
        query += " AND (labels LIKE ? OR labels LIKE ? OR labels LIKE ? OR labels = ?)"
        params.extend([f"{label},%", f"%,{label},%", f"%,{label}", label])
    
    if search:
        query += " AND (title LIKE ? OR description LIKE ?)"
        search_term = f"%{search}%"
        params.extend([search_term, search_term])
    
    if sprint_id is not None:
        query += " AND sprint_id = ?"
        params.append(sprint_id)
    
    query += " ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END, updated_at DESC"
    
    rows = db.execute(query, params).fetchall()
    result = []
    for row in rows:
        issue = dict(row)
        if issue['labels']:
            issue['labels'] = issue['labels'].split(',')
        else:
            issue['labels'] = []
        result.append(issue)
    return result


@router.post("/", status_code=201)
def create_issue(payload: CreateIssue):  #phx:R6
    if payload.sprint_id:
        sprint_exists = db.execute("SELECT id FROM sprints WHERE id = ?", (payload.sprint_id,)).fetchone()
        if not sprint_exists:
            raise HTTPException(status_code=400, detail="Sprint not found")
    
    labels_str = ""
    if payload.labels:
        labels_str = validate_labels(payload.labels)
    
    cur = db.execute("""
        INSERT INTO issues (title, description, status, priority, point_estimate, assignee, labels, sprint_id)
        VALUES (?, ?, 'backlog', ?, ?, ?, ?, ?)
    """, (payload.title, payload.description or "", payload.priority, payload.point_estimate, payload.assignee, labels_str, payload.sprint_id))  #phx:C1
    
    db.commit()
    row = db.execute("SELECT * FROM issues WHERE id = ?", (cur.lastrowid,)).fetchone()  #phx:R2
    issue = dict(row)
    if issue['labels']:
        issue['labels'] = issue['labels'].split(',')
    else:
        issue['labels'] = []
    return issue


@router.get("/{issue_id}")
def get_issue(issue_id: int):  #phx:R6
    row = db.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    issue = dict(row)
    if issue['labels']:
        issue['labels'] = issue['labels'].split(',')
    else:
        issue['labels'] = []
    return issue


@router.patch("/{issue_id}")
def update_issue(issue_id: int, payload: UpdateIssue):  #phx:R1,R6
    current_row = db.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    if current_row is None:
        raise HTTPException(status_code=404, detail="Not found")
    
    current_issue = dict(current_row)
    
    if payload.sprint_id is not None:
        sprint_exists = db.execute("SELECT id FROM sprints WHERE id = ?", (payload.sprint_id,)).fetchone()
        if not sprint_exists:
            raise HTTPException(status_code=400, detail="Sprint not found")
    
    if payload.status:
        validate_status_transition(current_issue['status'], payload.status)
        validate_backlog_exit(current_issue['status'], payload.status, payload.point_estimate or current_issue['point_estimate'])
    
    updates = []
    params = []
    
    if payload.title is not None:
        updates.append("title = ?")
        params.append(payload.title)
    
    if payload.description is not None:
        updates.append("description = ?")
        params.append(payload.description)
    
    if payload.status is not None:
        updates.append("status = ?")
        params.append(payload.status)
        
        # Handle completion timestamp
        if payload.status == 'done' and current_issue['status'] != 'done':
            updates.append("completed_at = datetime('now')")
        elif payload.status != 'done' and current_issue['status'] == 'done':
            updates.append("completed_at = NULL")
    
    if payload.priority is not None:
        updates.append("priority = ?")
        params.append(payload.priority)
    
    if payload.point_estimate is not None:
        updates.append("point_estimate = ?")
        params.append(payload.point_estimate)
    
    if payload.assignee is not None:
        updates.append("assignee = ?")
        params.append(payload.assignee)
    
    if payload.labels is not None:
        labels_str = validate_labels(payload.labels) if payload.labels else ""
        updates.append("labels = ?")
        params.append(labels_str)
    
    if payload.sprint_id is not None:
        updates.append("sprint_id = ?")
        params.append(payload.sprint_id)
    
    if updates:
        updates.append("updated_at = datetime('now')")
        params.append(issue_id)
        db.execute(f"UPDATE issues SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
    
    row = db.execute("SELECT * FROM issues WHERE id = ?", (issue_id,)).fetchone()
    issue = dict(row)
    if issue['labels']:
        issue['labels'] = issue['labels'].split(',')
    else:
        issue['labels'] = []
    return issue


@router.delete("/{issue_id}", status_code=204)
def delete_issue(issue_id: int):  #phx:R3,R6
    if db.execute("SELECT id FROM issues WHERE id = ?", (issue_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Not found")
    db.execute("DELETE FROM issues WHERE id = ?", (issue_id,))
    db.commit()

# @internal Phoenix VCS traceability — do not remove.
_phoenix = {
    "iu_id": "5df14a14fd32a2fa8c32571c305d78e16b30b82845662abd27db96cdaa3e1ddb",
    "name": "issue",
    "risk_tier": "high",
    "canon_ids": 14,
}
