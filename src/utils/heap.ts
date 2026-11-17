/**
 * High-performance MinBinaryHeap / PriorityQueue for A* pathfinding.
 */
export class MinBinaryHeap<T> {
  private heap: { element: T; priority: number }[] = [];

  public get size(): number {
    return this.heap.length;
  }

  public isEmpty(): boolean {
    return this.heap.length === 0;
  }

  public push(element: T, priority: number): void {
    this.heap.push({ element, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  public pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].element;
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  public peek(): T | undefined {
    return this.heap.length > 0 ? this.heap[0].element : undefined;
  }

  private bubbleUp(index: number): void {
    const item = this.heap[index];
    while (index > 0) {
      const parentIdx = (index - 1) >> 1;
      const parent = this.heap[parentIdx];
      if (item.priority >= parent.priority) break;
      this.heap[index] = parent;
      index = parentIdx;
    }
    this.heap[index] = item;
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    const item = this.heap[index];
    while (true) {
      const leftIdx = (index << 1) + 1;
      const rightIdx = leftIdx + 1;
      let smallestIdx = index;
      let smallestPriority = item.priority;

      if (leftIdx < length && this.heap[leftIdx].priority < smallestPriority) {
        smallestIdx = leftIdx;
        smallestPriority = this.heap[leftIdx].priority;
      }
      if (rightIdx < length && this.heap[rightIdx].priority < smallestPriority) {
        smallestIdx = rightIdx;
      }
      if (smallestIdx === index) break;

      this.heap[index] = this.heap[smallestIdx];
      index = smallestIdx;
    }
    this.heap[index] = item;
  }

  public clear(): void {
    this.heap.length = 0;
  }
}
